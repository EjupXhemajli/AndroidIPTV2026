package com.exiptv.player

import android.content.Context

object Prefs {
    private const val FILE = "exiptv"

    private fun sp(ctx: Context) = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun save(ctx: Context, host: String, user: String, pass: String) {
        sp(ctx).edit()
            .putString("host", host)
            .putString("user", user)
            .putString("pass", pass)
            .apply()
    }

    fun host(ctx: Context): String = sp(ctx).getString("host", "") ?: ""
    fun user(ctx: Context): String = sp(ctx).getString("user", "") ?: ""
    fun pass(ctx: Context): String = sp(ctx).getString("pass", "") ?: ""

    fun hasCreds(ctx: Context): Boolean = host(ctx).isNotBlank() && user(ctx).isNotBlank()

    fun clear(ctx: Context) = sp(ctx).edit().clear().apply()
}
