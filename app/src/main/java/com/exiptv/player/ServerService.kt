package com.exiptv.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.io.File

/**
 * Hält den eingebetteten EX-IPTV-Server (ein natives Go-Programm) als
 * Vordergrund-Dienst am Leben, damit Android ihn nicht beendet, während
 * die Oberfläche im WebView läuft.
 */
class ServerService : Service() {

    private var process: Process? = null
    @Volatile private var stopping = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundNotice()
        startServer()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    private fun startServer() {
        if (process != null) return
        Thread {
            try {
                // Das Server-Programm liegt als native Bibliothek vor und ist ausführbar.
                val binPath = File(applicationInfo.nativeLibraryDir, "libexiptvserver.so")
                if (!binPath.exists()) {
                    Log.e(TAG, "Server-Programm nicht gefunden: ${binPath.absolutePath}")
                    return@Thread
                }
                // Datenverzeichnis: App-eigener Speicher
                val dataDir = filesDir.absolutePath

                val pb = ProcessBuilder(binPath.absolutePath)
                pb.environment()["EXIPTV_DATA"] = dataDir
                pb.environment()["HOME"] = dataDir
                pb.redirectErrorStream(true)
                pb.directory(filesDir)
                val p = pb.start()
                process = p
                Log.i(TAG, "Server gestartet, Daten in $dataDir")

                // Ausgaben des Servers ins Log (zur Fehlersuche)
                p.inputStream.bufferedReader().use { reader ->
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        Log.i(TAG, "[server] ${line}")
                    }
                }
                val code = p.waitFor()
                Log.w(TAG, "Server beendet (Code $code)")
                if (!stopping) {
                    // Unerwartet beendet – nach kurzer Pause neu starten
                    Thread.sleep(1500)
                    process = null
                    startServer()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Server-Fehler: ${e.message}", e)
            }
        }.start()
    }

    private fun startForegroundNotice() {
        val channelId = "exiptv_server"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            val ch = NotificationChannel(
                channelId, "EX-IPTV Dienst",
                NotificationManager.IMPORTANCE_LOW
            )
            ch.setShowBadge(false)
            nm.createNotificationChannel(ch)
        }
        val notif: Notification = Notification.Builder(
            this,
            channelId
        ).setContentTitle("EX-IPTV läuft")
            .setContentText("Wiedergabe-Dienst aktiv")
            .setSmallIcon(R.mipmap.ic_launcher)
            .build()
        startForeground(1, notif)
    }

    override fun onDestroy() {
        stopping = true
        try { process?.destroy() } catch (_: Exception) {}
        process = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "EXIPTV-Server"
    }
}
