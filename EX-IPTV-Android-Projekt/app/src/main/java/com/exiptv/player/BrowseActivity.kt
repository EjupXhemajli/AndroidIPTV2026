package com.exiptv.player

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.exiptv.player.databinding.ActivityBrowseBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class BrowseActivity : AppCompatActivity() {

    private lateinit var b: ActivityBrowseBinding
    private lateinit var client: XtreamClient

    private val catAdapter = CategoryAdapter { cat -> loadChannels(cat) }
    private val chAdapter = ChannelAdapter { ch -> openPlayer(ch) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityBrowseBinding.inflate(layoutInflater)
        setContentView(b.root)

        client = XtreamClient(Prefs.host(this), Prefs.user(this), Prefs.pass(this))

        b.rvCategories.layoutManager = LinearLayoutManager(this)
        b.rvCategories.adapter = catAdapter
        b.rvChannels.layoutManager = LinearLayoutManager(this)
        b.rvChannels.adapter = chAdapter

        b.btnLogout.setOnClickListener {
            Prefs.clear(this)
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }

        loadCategories()
    }

    private fun loadCategories() {
        b.progress.visibility = View.VISIBLE
        lifecycleScope.launch {
            val cats = withContext(Dispatchers.IO) {
                try { client.liveCategories() } catch (e: Exception) { emptyList() }
            }
            b.progress.visibility = View.GONE
            if (cats.isEmpty()) {
                toast(getString(R.string.load_failed))
                return@launch
            }
            catAdapter.submit(cats)
            loadChannels(cats[0])
        }
    }

    private fun loadChannels(cat: Category) {
        b.tvChannelsTitle.text = cat.name
        b.progress.visibility = View.VISIBLE
        lifecycleScope.launch {
            val chs = withContext(Dispatchers.IO) {
                try { client.liveStreams(cat.id) } catch (e: Exception) { emptyList() }
            }
            b.progress.visibility = View.GONE
            chAdapter.submit(chs)
        }
    }

    private fun openPlayer(ch: Channel) {
        val url = client.liveUrl(ch.streamId)
        startActivity(
            Intent(this, PlayerActivity::class.java)
                .putExtra("url", url)
                .putExtra("title", ch.name)
        )
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
