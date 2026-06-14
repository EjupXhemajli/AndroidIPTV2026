package com.exiptv.player

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.exiptv.player.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Sind schon Zugangsdaten gespeichert? Dann direkt zur Senderübersicht.
        if (Prefs.hasCreds(this)) {
            startBrowse()
            return
        }

        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)

        b.btnLogin.setOnClickListener { doLogin() }
    }

    private fun doLogin() {
        val host = b.etHost.text.toString().trim()
        val user = b.etUser.text.toString().trim()
        val pass = b.etPass.text.toString().trim()

        if (host.isEmpty() || user.isEmpty()) {
            toast(getString(R.string.enter_server_user))
            return
        }

        b.btnLogin.isEnabled = false
        b.progress.visibility = View.VISIBLE

        lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) {
                try {
                    XtreamClient(host, user, pass).login()
                } catch (e: Exception) {
                    false
                }
            }
            b.progress.visibility = View.GONE
            b.btnLogin.isEnabled = true
            if (ok) {
                Prefs.save(this@MainActivity, host, user, pass)
                startBrowse()
            } else {
                toast(getString(R.string.login_failed))
            }
        }
    }

    private fun startBrowse() {
        startActivity(Intent(this, BrowseActivity::class.java))
        finish()
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
