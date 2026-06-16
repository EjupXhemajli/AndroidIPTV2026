package com.exiptv.player

import android.annotation.SuppressLint
import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.JavascriptInterface
import android.widget.FrameLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import java.net.HttpURLConnection
import java.net.URL

@UnstableApi
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private val handler = Handler(Looper.getMainLooper())
    private val baseUrl = "http://127.0.0.1:8765/"
    private var loaded = false
    private var isTv = false

    // --- Nativer Player ---
    private var player: ExoPlayer? = null
    private var playerView: PlayerView? = null
    private var playerVisible = false
    private var isVod = false                // Film/Serie statt Live
    private var vodTicker: Runnable? = null   // meldet VOD-Position an die Oberflaeche
    private var resumeMs = 0L                 // Fortsetz-Punkt fuer VOD
    private var aspectMode = 0                 // 0=Anpassen 1=Zoom/Vollbild 2=Strecken
    private var currentKey: String = ""
    private var attempts = 0                 // Fehlversuche für den aktuellen Sender
    private val maxAttempts = 3              // nach 3 Fehlversuchen -> nächster Sender
    private var consecutiveSkips = 0         // Schutz gegen Endlos-Durchlauf
    private val maxConsecutiveSkips = 30
    private var lastUrl = ""
    private var lastTitle = ""
    private var lastKind = ""

    // Wächter gegen Einfrieren
    private var watchdog: Runnable? = null
    private var lastPos = -1L
    private var stuckSince = 0L
    private var bufferingSince = 0L
    private var lastFailureAt = 0L
    // Bildzählung: erkennt ein eingefrorenes Bild, OBWOHL die Abspielzeit weiterläuft
    // (hängender Decoder – das alte Problem, das die reine Positionsprüfung verfehlte).
    private var lastFrames = -1
    private var framesStuckSince = 0L
    private var everRendered = false
    private val frameFreezeMs = 6_000L     // keine neuen Bilder -> Standbild
    private val posFreezeMs = 10_000L      // Abspielzeit steht (Aufbau / Audio-only)

    // Sendername-Einblendung im nativen Player
    private var titleBar: TextView? = null
    private var titleHide: Runnable? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        isTv = detectTv()

        val svc = Intent(this, ServerService::class.java)
        ContextCompat.startForegroundService(this, svc)

        root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#0a0e1a"))

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0a0e1a"))
        root.addView(
            web,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(root)

        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.allowContentAccess = true
        s.allowFileAccess = true
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        s.javaScriptCanOpenWindowsAutomatically = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        // Brücke: die Oberfläche (JavaScript) ruft hierüber den nativen Player auf
        web.addJavascriptInterface(AndroidPlayerBridge(), "AndroidPlayer")

        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = false
            override fun onReceivedError(
                view: WebView?, request: WebResourceRequest?, error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true && !loaded) {
                    handler.postDelayed({ tryLoad() }, 700)
                }
            }
        }

        setupPlayer()

        showWaiting()
        waitForServerThenLoad()
    }

    /** Erkennt, ob die App auf einem Fernseher/TV-Box/Fire-Stick läuft. */
    private fun detectTv(): Boolean {
        val uiMode = getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        if (uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return true
        val pm = packageManager
        if (pm.hasSystemFeature("android.software.leanback")) return true
        if (!pm.hasSystemFeature("android.hardware.touchscreen")) return true
        return false
    }

    private fun targetUrl(): String = if (isTv) baseUrl + "?tv=1" else baseUrl

    // ---------------- Nativer Player ----------------

    private fun createPlayer(): ExoPlayer {
        // Großzügige Puffer für stabile Wiedergabe (gegen Ruckler/Aussetzer)
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                15_000,   // min gepuffert
                60_000,   // max gepuffert
                2_500,    // gepuffert vor Start
                5_000     // gepuffert nach erneutem Puffern
            )
            .build()

        // Decoder-Fallback: hängt der Hardware-Decoder (typisch bei 4K-Sendern auf
        // der Box), schaltet ExoPlayer auf einen anderen Decoder um, statt das Bild
        // einfrieren zu lassen.
        val renderers = DefaultRenderersFactory(this)
            .setEnableDecoderFallback(true)

        val p = ExoPlayer.Builder(this)
            .setLoadControl(loadControl)
            .setRenderersFactory(renderers)
            .setSeekBackIncrementMs(15_000)
            .setSeekForwardIncrementMs(15_000)
            .build()
        p.playWhenReady = true
        // Hält Netzwerk/CPU während der Wiedergabe wach -> keine Aussetzer durch
        // WLAN-/CPU-Schlaf der TV-Box.
        p.setWakeMode(C.WAKE_MODE_NETWORK)
        // Audio-Fokus sauber anfordern.
        p.setAudioAttributes(
            AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .setUsage(C.USAGE_MEDIA)
                .build(),
            true
        )

        p.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                handleFailure("Fehler: " + (error.errorCodeName))
            }

            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_READY -> {
                        // Läuft -> Zähler zurücksetzen
                        attempts = 0
                        consecutiveSkips = 0
                        bufferingSince = 0
                        stuckSince = 0
                    }
                    Player.STATE_BUFFERING -> {
                        if (bufferingSince == 0L) bufferingSince = System.currentTimeMillis()
                    }
                    Player.STATE_ENDED -> {
                        if (isVod) {
                            web.evaluateJavascript("window.EXNATIVE && EXNATIVE.vodEnded()", null)
                        } else {
                            handleFailure("Stream beendet")
                        }
                    }
                    else -> {}
                }
            }
        })
        return p
    }

    private fun setupPlayer() {
        val p = createPlayer()

        val pv = PlayerView(this)
        pv.useController = false
        pv.setShutterBackgroundColor(Color.BLACK)
        pv.keepScreenOn = true
        pv.player = p
        pv.visibility = android.view.View.GONE
        root.addView(
            pv,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER
            )
        )

        player = p
        playerView = pv

        // Sendername-Einblendung (oben mittig), über dem Video.
        val dm = resources.displayMetrics
        val tb = TextView(this)
        tb.setTextColor(Color.WHITE)
        tb.textSize = 18f
        tb.setBackgroundColor(Color.parseColor("#CC0A0E1A"))
        val padH = (18 * dm.density).toInt()
        val padV = (10 * dm.density).toInt()
        tb.setPadding(padH, padV, padH, padV)
        tb.visibility = android.view.View.GONE
        val lp = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP or Gravity.CENTER_HORIZONTAL
        )
        lp.topMargin = (28 * dm.density).toInt()
        root.addView(tb, lp)
        titleBar = tb
    }

    /** Blendet den Sendernamen kurz ein (beim Start und beim Umschalten). */
    private fun flashTitle(title: String) {
        val tb = titleBar ?: return
        if (title.isBlank()) { tb.visibility = android.view.View.GONE; return }
        tb.text = title
        tb.visibility = android.view.View.VISIBLE
        titleHide?.let { handler.removeCallbacks(it) }
        val r = Runnable { tb.visibility = android.view.View.GONE }
        titleHide = r
        handler.postDelayed(r, 3500)
    }

    private fun buildSource(url: String, kind: String): MediaSource {
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("EX-IPTV/1.0")
            .setConnectTimeoutMs(20_000)
            .setReadTimeoutMs(20_000)
            .setAllowCrossProtocolRedirects(true)
        val item = MediaItem.fromUri(url)
        val isHls = kind.equals("hls", true) || url.contains(".m3u8", true)
        return if (isHls) {
            HlsMediaSource.Factory(http).createMediaSource(item)
        } else {
            ProgressiveMediaSource.Factory(http).createMediaSource(item)
        }
    }

    private fun startNative(url: String, title: String, key: String, kind: String) {
        val p = player ?: return
        isVod = false
        stopVodTicker()
        playerView?.useController = false
        if (key != currentKey) {
            currentKey = key
            attempts = 0
        }
        lastUrl = url; lastTitle = title; lastKind = kind
        try {
            p.setMediaSource(buildSource(url, kind))
            p.prepare()
            p.playWhenReady = true
        } catch (e: Exception) {
            handleFailure("Aufbau fehlgeschlagen")
            return
        }
        showPlayer()
        flashTitle(title)
        startWatchdog()
    }

    /** Film/Serie nativ abspielen: mit Bedienleiste (Spulen), Fortsetz-Punkt und
     *  Positions-Meldung an die Oberflaeche fuer „Weiter schauen". */
    private fun startNativeVod(url: String, title: String, key: String, kind: String, resumeSec: Long) {
        val p = player ?: return
        isVod = true
        stopWatchdog()                  // Live-Wächter (Senderwechsel) gilt fuer VOD nicht
        currentKey = key
        attempts = 0
        resumeMs = (if (resumeSec > 0) resumeSec * 1000L else 0L)
        lastUrl = url; lastTitle = title; lastKind = kind
        try {
            p.setMediaSource(buildSource(url, kind))
            p.prepare()
            if (resumeMs > 0) p.seekTo(resumeMs)
            p.playWhenReady = true
        } catch (e: Exception) {
            return
        }
        playerView?.useController = true
        playerView?.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        aspectMode = 0
        playerView?.setShowFastForwardButton(true)
        playerView?.setShowRewindButton(true)
        playerView?.controllerShowTimeoutMs = 3500
        showPlayer()
        playerView?.requestFocus()
        flashTitle(title)
        startVodTicker()
    }

    private fun startVodTicker() {
        stopVodTicker()
        val r = object : Runnable {
            override fun run() {
                if (!playerVisible || !isVod) return
                val p = player
                if (p != null && p.playbackState == Player.STATE_READY) {
                    val pos = p.currentPosition / 1000
                    val dur = if (p.duration > 0) p.duration / 1000 else 0
                    if (pos >= 0 && dur > 0) {
                        web.evaluateJavascript("window.EXNATIVE && EXNATIVE.vodPos($pos,$dur)", null)
                    }
                }
                handler.postDelayed(this, 8000)
            }
        }
        vodTicker = r
        handler.postDelayed(r, 8000)
    }

    private fun stopVodTicker() {
        vodTicker?.let { handler.removeCallbacks(it) }
        vodTicker = null
    }

    /** Bildformat umschalten: Anpassen -> Zoom (Vollbild) -> Strecken. */
    private fun cycleAspect() {
        val pv = playerView ?: return
        aspectMode = (aspectMode + 1) % 3
        val label: String
        pv.resizeMode = when (aspectMode) {
            1 -> { label = "Zoom (Vollbild)"; AspectRatioFrameLayout.RESIZE_MODE_ZOOM }
            2 -> { label = "Strecken"; AspectRatioFrameLayout.RESIZE_MODE_FILL }
            else -> { label = "Anpassen"; AspectRatioFrameLayout.RESIZE_MODE_FIT }
        }
        flashTitle("Bildformat: $label")
    }

    /** Nächste Tonspur wählen (mehrsprachige Filme). */
    private fun cycleAudio() {
        val p = player ?: return
        val groups = ArrayList<androidx.media3.common.Tracks.Group>()
        for (g in p.currentTracks.groups) if (g.type == C.TRACK_TYPE_AUDIO) groups.add(g)
        // Alle abspielbaren Tonspuren flach auflisten
        val gs = ArrayList<androidx.media3.common.Tracks.Group>()
        val tis = ArrayList<Int>()
        for (g in groups) for (i in 0 until g.length) if (g.isTrackSupported(i)) { gs.add(g); tis.add(i) }
        if (gs.size <= 1) { flashTitle("Nur eine Tonspur"); return }
        var cur = -1
        for (k in gs.indices) if (gs[k].isTrackSelected(tis[k])) { cur = k; break }
        val next = (cur + 1) % gs.size
        try {
            p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
                .setOverrideForType(TrackSelectionOverride(gs[next].mediaTrackGroup, tis[next]))
                .build()
        } catch (e: Exception) { return }
        val fmt = gs[next].getTrackFormat(tis[next])
        val parts = ArrayList<String>()
        if (!fmt.label.isNullOrBlank()) parts.add(fmt.label!!)
        if (!fmt.language.isNullOrBlank()) parts.add(fmt.language!!)
        flashTitle("Ton: " + (if (parts.isEmpty()) "Spur ${next + 1}" else parts.joinToString(" · ")))
    }

    private fun retrySame() {
        val p = player ?: return
        try {
            p.setMediaSource(buildSource(lastUrl, lastKind))
            p.prepare()
            p.playWhenReady = true
        } catch (e: Exception) {
            handleFailure("Neuversuch fehlgeschlagen")
        }
        stuckSince = 0; bufferingSince = 0; lastPos = -1
        lastFrames = -1; framesStuckSince = 0; everRendered = false
    }

    /** Vollständige Wiederherstellung: Player freigeben, neu erstellen, Stream neu
     *  starten. Löst hängende Decoder/Surface, die ein bloßes Neuladen nicht behebt. */
    private fun hardRecover() {
        if (!playerVisible) return
        val pv = playerView ?: return
        try { player?.release() } catch (e: Exception) {}
        player = null
        val np = createPlayer()
        pv.player = np
        player = np
        try {
            np.setMediaSource(buildSource(lastUrl, lastKind))
            np.prepare()
            np.playWhenReady = true
        } catch (e: Exception) {}
        stuckSince = 0; bufferingSince = 0; lastPos = -1
        lastFrames = -1; framesStuckSince = 0; everRendered = false
    }

    /** Fehlerbehandlung: Neuladen -> Player neu erstellen -> nächster Sender. */
    private fun handleFailure(reason: String) {
        if (!playerVisible) return
        val now = System.currentTimeMillis()
        // Doppelte Auslösung (Fehler-Listener + Wächter) für DASSELBE Ereignis
        // unterdrücken. Die Neuversuch-Verzögerung (2,5s) liegt bewusst über
        // dieser Sperre, damit ein echter Folgefehler wieder gezählt wird.
        if (now - lastFailureAt < 2000) return
        lastFailureAt = now
        stuckSince = 0; bufferingSince = 0; lastPos = -1
        lastFrames = -1; framesStuckSince = 0; everRendered = false

        attempts++
        if (attempts < maxAttempts) {
            if (attempts == 1) {
                // 1. Neuversuch: nur Stream neu laden (behebt kurze Aussetzer)
                handler.postDelayed({ if (playerVisible) retrySame() }, 2500)
            } else {
                // 2. Neuversuch: Player vollständig neu erstellen (behebt Hänger)
                handler.postDelayed({ if (playerVisible) hardRecover() }, 2500)
            }
        } else if (isVod) {
            // Film/Serie: NICHT zum „nächsten Sender" springen. Nach den
            // Neuversuchen den Zähler zurücksetzen und stehen lassen.
            attempts = 0
        } else {
            attempts = 0
            consecutiveSkips++
            stopWatchdog()  // bis der nächste Sender startet, nicht weiter prüfen
            if (consecutiveSkips > maxConsecutiveSkips) {
                consecutiveSkips = 0
                return
            }
            // Oberfläche bittet, den nächsten Sender zu starten
            handler.postDelayed({
                if (playerVisible) {
                    web.evaluateJavascript("window.EXNATIVE && EXNATIVE.failed()", null)
                }
            }, 800)
        }
    }

    private fun showPlayer() {
        playerVisible = true
        playerView?.visibility = android.view.View.VISIBLE
        playerView?.keepScreenOn = true
    }

    private fun closeNative() {
        playerVisible = false
        stopWatchdog()
        stopVodTicker()
        titleHide?.let { handler.removeCallbacks(it) }
        titleBar?.visibility = android.view.View.GONE
        try { player?.stop() } catch (e: Exception) {}
        try { player?.clearMediaItems() } catch (e: Exception) {}
        playerView?.useController = false
        playerView?.visibility = android.view.View.GONE
        playerView?.keepScreenOn = false
        isVod = false
        resumeMs = 0
        currentKey = ""
        attempts = 0
        consecutiveSkips = 0
    }

    // --- Wächter gegen Einfrieren: prüft, ob das Bild wirklich läuft ---
    private fun startWatchdog() {
        stopWatchdog()
        lastPos = -1L
        stuckSince = 0L
        bufferingSince = 0L
        lastFrames = -1
        framesStuckSince = 0L
        everRendered = false
        val r = object : Runnable {
            override fun run() {
                if (!playerVisible) return
                val p = player
                if (p != null) {
                    val now = System.currentTimeMillis()
                    val state = p.playbackState
                    val pos = p.currentPosition

                    if (state == Player.STATE_BUFFERING) {
                        // zu lange am Puffern -> als Hänger behandeln
                        if (bufferingSince == 0L) bufferingSince = now
                        if (now - bufferingSince > 12_000) {
                            bufferingSince = 0L
                            handleFailure("zu lange gepuffert")
                            return scheduleNext()
                        }
                    } else if (state == Player.STATE_READY && p.playWhenReady) {
                        bufferingSince = 0L
                        val frames = p.videoDecoderCounters?.renderedOutputBufferCount ?: -1
                        val advancing = frames > lastFrames
                        if (frames > lastFrames) lastFrames = frames
                        if (frames > 0) everRendered = true

                        if (everRendered) {
                            // Kommen wirklich neue Bilder an? Erkennt ein Standbild
                            // auch dann, wenn die Abspielzeit normal weiterläuft
                            // (hängender Decoder) – das war die alte Lücke.
                            if (advancing) {
                                framesStuckSince = 0L
                                stuckSince = 0L
                                lastPos = pos
                            } else {
                                if (framesStuckSince == 0L) framesStuckSince = now
                                if (now - framesStuckSince > frameFreezeMs) {
                                    framesStuckSince = 0L
                                    handleFailure("Standbild (keine neuen Bilder)")
                                    return scheduleNext()
                                }
                            }
                        } else {
                            // Noch kein Bild gerendert (Aufbau oder Audio-only):
                            // auf die Abspielzeit zurückfallen.
                            if (pos == lastPos) {
                                if (stuckSince == 0L) stuckSince = now
                                if (now - stuckSince > posFreezeMs) {
                                    stuckSince = 0L
                                    handleFailure("Bild steht")
                                    return scheduleNext()
                                }
                            } else {
                                stuckSince = 0L
                                lastPos = pos
                            }
                        }
                    }
                }
                scheduleNext()
            }
            private fun scheduleNext() {
                handler.postDelayed(this, 2000)
            }
        }
        watchdog = r
        handler.postDelayed(r, 2000)
    }

    private fun stopWatchdog() {
        watchdog?.let { handler.removeCallbacks(it) }
        watchdog = null
    }

    /** Von der Oberfläche (JavaScript) aufrufbare Brücke. */
    inner class AndroidPlayerBridge {
        @JavascriptInterface
        fun play(url: String, title: String, key: String, kind: String) {
            handler.post { startNative(url, title, key, kind) }
        }

        @JavascriptInterface
        fun playVod(url: String, title: String, key: String, kind: String, resumeSec: Int) {
            handler.post { startNativeVod(url, title, key, kind, resumeSec.toLong()) }
        }

        @JavascriptInterface
        fun vodSeek(sec: Int) {
            handler.post {
                if (isVod) { try { player?.seekTo(sec.toLong() * 1000L) } catch (e: Exception) {} }
            }
        }

        @JavascriptInterface
        fun stop() {
            handler.post { closeNative() }
        }
    }

    // ---------------- WebView laden ----------------

    private fun showWaiting() {
        val html = """
            <html><body style="margin:0;background:#0a0e1a;color:#8B94A8;
            font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
            <div style="text-align:center;">
              <div style="font-size:28px;font-weight:bold;
                background:linear-gradient(90deg,#8B5CF6,#22D3EE);-webkit-background-clip:text;
                -webkit-text-fill-color:transparent;">EX-IPTV</div>
              <div style="margin-top:14px;">Wird gestartet …</div>
            </div></body></html>
        """.trimIndent()
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    private fun waitForServerThenLoad() {
        Thread {
            var ok = false
            for (i in 0 until 60) {
                if (ping()) { ok = true; break }
                Thread.sleep(500)
            }
            handler.post {
                if (ok) tryLoad()
                else handler.postDelayed({ waitForServerThenLoad() }, 1000)
            }
        }.start()
    }

    private fun ping(): Boolean {
        return try {
            val c = URL(baseUrl + "api/ping").openConnection() as HttpURLConnection
            c.connectTimeout = 800
            c.readTimeout = 800
            c.requestMethod = "GET"
            val code = c.responseCode
            c.disconnect()
            code in 200..299
        } catch (e: Exception) {
            false
        }
    }

    private fun tryLoad() {
        if (loaded) return
        loaded = true
        web.loadUrl(targetUrl())
    }

    // ---------------- Fernbedienung ----------------

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Läuft der native VOD-Player (Film/Serie)? Eigene Steuerung: spulen + Pause.
        if (playerVisible && isVod && event.action == KeyEvent.ACTION_DOWN) {
            val p = player
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> {
                    if (p != null) {
                        val to = (p.currentPosition - 15_000).coerceAtLeast(0)
                        p.seekTo(to); playerView?.showController()
                    }
                    return true
                }
                KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                    if (p != null) {
                        val dur = if (p.duration > 0) p.duration else Long.MAX_VALUE
                        val to = (p.currentPosition + 15_000).coerceAtMost(dur)
                        p.seekTo(to); playerView?.showController()
                    }
                    return true
                }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
                KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                    if (p != null) { p.playWhenReady = !p.playWhenReady; playerView?.showController() }
                    return true
                }
                KeyEvent.KEYCODE_BACK -> {
                    closeNative()
                    web.evaluateJavascript("window.EXNATIVE && EXNATIVE.vodClosed()", null)
                    return true
                }
                KeyEvent.KEYCODE_DPAD_UP -> {
                    cycleAspect(); return true
                }
                KeyEvent.KEYCODE_DPAD_DOWN -> {
                    cycleAudio(); return true
                }
                else -> {}
            }
        }

        // Läuft der native Live-Player? Dann steuern die Tasten den Player.
        if (playerVisible && !isVod && event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> {
                    web.evaluateJavascript("window.EXNATIVE && EXNATIVE.zap(-1)", null); return true
                }
                KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> {
                    web.evaluateJavascript("window.EXNATIVE && EXNATIVE.zap(1)", null); return true
                }
                KeyEvent.KEYCODE_BACK -> {
                    closeNative()
                    web.evaluateJavascript("window.EXNATIVE && EXNATIVE.closed()", null)
                    return true
                }
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                    return true  // im Player ignorieren, nicht an die Oberfläche durchreichen
                }
                else -> {}
            }
        }

        // Sonst: normale Steuerkreuz-Navigation der Oberfläche (im TV-Modus)
        if (isTv && loaded && event.action == KeyEvent.ACTION_DOWN) {
            val dir = when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> "left"
                KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
                KeyEvent.KEYCODE_DPAD_UP -> "up"
                KeyEvent.KEYCODE_DPAD_DOWN -> "down"
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "ok"
                else -> null
            }
            if (dir != null) {
                web.evaluateJavascript("window.EXTV && EXTV.key('$dir')", null)
                return true
            }
            if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                web.evaluateJavascript("(window.EXTV && EXTV.key('back'))") { result ->
                    if (result == null || result == "false" || result == "null") {
                        handler.post { if (web.canGoBack()) web.goBack() else finish() }
                    }
                }
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (!isTv && keyCode == KeyEvent.KEYCODE_BACK) {
            if (playerVisible) {
                closeNative()
                val cb = if (isVod) "EXNATIVE.vodClosed()" else "EXNATIVE.closed()"
                web.evaluateJavascript("window.EXNATIVE && $cb", null)
                return true
            }
            if (::web.isInitialized && web.canGoBack()) { web.goBack(); return true }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) web.onResume()
    }

    override fun onPause() {
        super.onPause()
        if (::web.isInitialized) web.onPause()
    }

    override fun onDestroy() {
        stopWatchdog()
        stopVodTicker()
        titleHide?.let { handler.removeCallbacks(it) }
        try { player?.release() } catch (e: Exception) {}
        player = null
        super.onDestroy()
    }
}
