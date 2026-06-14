package com.exiptv.player

import android.os.Bundle
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import com.exiptv.player.databinding.ActivityPlayerBinding

class PlayerActivity : AppCompatActivity() {

    private lateinit var b: ActivityPlayerBinding
    private var player: ExoPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(b.root)
        // Bildschirm während der Wiedergabe anlassen
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun onStart() {
        super.onStart()
        startPlayback()
    }

    override fun onStop() {
        super.onStop()
        releasePlayer()
    }

    private fun startPlayback() {
        val url = intent.getStringExtra("url") ?: return
        val p = ExoPlayer.Builder(this).build()
        b.playerView.player = p
        p.setMediaItem(MediaItem.fromUri(url))
        p.playWhenReady = true
        p.prepare()
        player = p
    }

    private fun releasePlayer() {
        player?.release()
        player = null
        b.playerView.player = null
    }
}
