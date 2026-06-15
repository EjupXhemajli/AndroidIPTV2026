package com.exiptv.player

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private val handler = Handler(Looper.getMainLooper())
    private val serverUrl = "http://127.0.0.1:8765/"
    private var loaded = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Server-Dienst starten
        val svc = Intent(this, ServerService::class.java)
        ContextCompat.startForegroundService(this, svc)

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0a0e1a"))
        setContentView(web)

        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.mediaPlaybackRequiresUserGesture = false   // Autoplay erlauben
        s.allowContentAccess = true
        s.allowFileAccess = true
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        s.javaScriptCanOpenWindowsAutomatically = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW  // HTTP-Streams erlauben
        }
        s.mediaPlaybackRequiresUserGesture = false

        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false // alles im WebView laden
            }
            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                // Server evtl. noch nicht bereit – erneut versuchen
                if (request?.isForMainFrame == true && !loaded) {
                    handler.postDelayed({ tryLoad() }, 700)
                }
            }
        }

        // Auf den Server warten und dann laden
        showWaiting()
        waitForServerThenLoad()
    }

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
            // Bis zu ~30 Sekunden auf den Server warten
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
            val c = URL(serverUrl + "api/ping").openConnection() as HttpURLConnection
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
        web.loadUrl(serverUrl)
    }

    // Zurück-Taste: im WebView navigieren statt App zu schließen
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && ::web.isInitialized && web.canGoBack()) {
            web.goBack()
            return true
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
}
