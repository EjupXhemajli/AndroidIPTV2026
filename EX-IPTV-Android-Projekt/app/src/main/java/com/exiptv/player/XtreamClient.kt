package com.exiptv.player

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Minimaler Client für Xtream-Codes-Anbieter.
 * Holt Live-Kategorien und -Sender und baut die Wiedergabe-Adresse.
 */
class XtreamClient(rawHost: String, private val user: String, private val pass: String) {

    val base: String = normalize(rawHost)

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private fun normalize(h: String): String {
        var s = h.trim().trimEnd('/')
        if (!s.startsWith("http://", true) && !s.startsWith("https://", true)) {
            s = "http://$s"
        }
        return s
    }

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

    private fun apiUrl(action: String, extra: String = ""): String =
        "$base/player_api.php?username=${enc(user)}&password=${enc(pass)}&action=$action$extra"

    private fun get(url: String): String {
        val req = Request.Builder()
            .url(url)
            .header("User-Agent", "EX-IPTV/0.1 (Android)")
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
            return resp.body?.string() ?: ""
        }
    }

    /** Prüft, ob Server und Zugangsdaten gültig sind. */
    fun login(): Boolean {
        val url = "$base/player_api.php?username=${enc(user)}&password=${enc(pass)}"
        val body = get(url)
        val obj = JSONObject(body)
        val info = obj.optJSONObject("user_info") ?: return false
        val auth = info.optInt("auth", 0)
        val status = info.optString("status")
        return auth == 1 || status.equals("Active", ignoreCase = true)
    }

    fun liveCategories(): List<Category> {
        val arr = JSONArray(get(apiUrl("get_live_categories")))
        val out = ArrayList<Category>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out.add(Category(o.opt("category_id").toString(), o.optString("category_name")))
        }
        return out
    }

    fun liveStreams(categoryId: String): List<Channel> {
        val arr = JSONArray(get(apiUrl("get_live_streams", "&category_id=${enc(categoryId)}")))
        val out = ArrayList<Channel>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val id = o.opt("stream_id").toString()
            val name = o.optString("name")
            val icon = o.optString("stream_icon").takeIf { it.isNotBlank() }
            out.add(Channel(id, name, icon))
        }
        return out
    }

    /** Wiedergabe-Adresse eines Live-Senders (Transportstrom). */
    fun liveUrl(streamId: String): String =
        "$base/live/${enc(user)}/${enc(pass)}/$streamId.ts"
}
