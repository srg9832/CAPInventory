package org.capinventory.local

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.io.FilterInputStream
import java.io.InputStream
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Base64
import java.util.UUID

/** Bundled website (no hosted data); native HTTPS relay is *only* to CAPWATCH, on device. */
class MainActivity : ComponentActivity() {
    private val appHost = "appassets.androidplatform.net"
    private val remoteEndpoint = "https://www.capnhq.gov/CAP.CapWatchAPI.Web/api/cw"
    private lateinit var webView: WebView
    private var webPermission: PermissionRequest? = null
    private var fileCallback: android.webkit.ValueCallback<Array<Uri>>? = null
    private val exportGuard = Any()
    private var exportInProgress: ExportJob? = null
    private var exportToSave: ExportJob? = null
    private data class ExportJob(val token: String, val file: File, val name: String, val mime: String, var count: Long = 0L)

    private val cameraLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val request = webPermission; webPermission = null
        if (granted) request?.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request?.deny()
    }
    private val pickFileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uris = if (result.resultCode == Activity.RESULT_OK) {
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        } else null
        fileCallback?.onReceiveValue(uris)
        fileCallback = null
    }
    private val saveLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val job = exportToSave; exportToSave = null
        if (job != null) {
            try {
                if (result.resultCode == Activity.RESULT_OK) {
                    val uri = result.data?.data ?: error("No destination selected")
                    contentResolver.openOutputStream(uri)?.use { output -> job.file.inputStream().use { it.copyTo(output) } }
                        ?: error("Unable to save export")
                    toast("Export saved")
                }
            } catch (_: Exception) { toast("Could not save export file") }
            finally { job.file.delete() }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE, android.view.WindowManager.LayoutParams.FLAG_SECURE)
        val loader = WebViewAssetLoader.Builder()
            .setDomain(appHost)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView = WebView(this)
        setContentView(webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = true // User-selected ZIP and backup files only
        webView.settings.javaScriptCanOpenWindowsAutomatically = false
        webView.settings.setSupportMultipleWindows(false)
        webView.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        webView.settings.mediaPlaybackRequiresUserGesture = true
        webView.addJavascriptInterface(Exports(), "NativeFile")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest): WebResourceResponse? {
                val uri = request.url
                if (uri.scheme != "https" || uri.host != appHost) return blocked()
                if (uri.encodedPath == "/capwatch-api/cw") return capwatchRequest(request)
                return loader.shouldInterceptRequest(uri) ?: blocked()
            }
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && uri.host == appHost) return false
                if (uri.scheme == "https" && uri.host != appHost) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: Exception) { toast("No browser available") }
                }
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (request.origin?.scheme != "https" || request.origin?.host != appHost ||
                        !request.resources.contentEquals(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))) {
                        request.deny(); return@runOnUiThread
                    }
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    } else {
                        webPermission = request
                        cameraLauncher.launch(Manifest.permission.CAMERA)
                    }
                }
            }
            override fun onShowFileChooser(webView: WebView?, newCallback: android.webkit.ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = newCallback
                return try {
                    val intent = params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).setType("*/*")
                    pickFileLauncher.launch(intent)
                    true
                } catch (_: ActivityNotFoundException) {
                    fileCallback?.onReceiveValue(null); fileCallback = null; false
                }
            }
            override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity).setMessage(message ?: "")
                    .setPositiveButton("OK") { _, _ -> result.confirm() }
                    .setOnCancelListener { result.cancel() }.show()
                return true
            }
            override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity).setMessage(message ?: "")
                    .setPositiveButton("OK") { _, _ -> result.confirm() }
                    .setNegativeButton("Cancel") { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }.show()
                return true
            }
            override fun onJsPrompt(view: WebView?, url: String?, message: String?, defaultValue: String?, result: JsPromptResult): Boolean {
                val input = EditText(this@MainActivity)
                input.setText(defaultValue ?: "")
                input.setSingleLine(true)
                input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                AlertDialog.Builder(this@MainActivity).setMessage(message ?: "")
                    .setView(input).setPositiveButton("OK") { _, _ -> result.confirm(input.text.toString()) }
                    .setNegativeButton("Cancel") { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }.show()
                return true
            }
        }
        webView.loadUrl("https://$appHost/assets/index.html")
    }

    private fun capwatchRequest(request: WebResourceRequest): WebResourceResponse {
        if (request.method != "GET") return response(405, "Method Not Allowed", "Method not permitted")
        val orgid = request.url.getQueryParameter("ORGID") ?: ""
        val unitOnly = request.url.getQueryParameter("unitOnly") ?: ""
        if (!orgid.matches(Regex("[0-9]{1,12}")) || unitOnly !in listOf("0", "1"))
            return response(400, "Bad Request", "Invalid CAPWATCH scope")
        val auth = request.requestHeaders.entries.firstOrNull { it.key.equals("authorization", ignoreCase = true) }?.value ?: ""
        if (!auth.startsWith("Basic ") || auth.length !in 12..2048)
            return response(401, "Unauthorized", "CAPID and password required")
        val url = URL("$remoteEndpoint?ORGID=$orgid&unitOnly=$unitOnly")
        var connection: HttpURLConnection? = null
        return try {
            connection = url.openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false // Never forward Authorization to a redirect target
            connection.connectTimeout = 30000
            connection.readTimeout = 600000
            connection.setRequestProperty("Authorization", auth)
            connection.setRequestProperty("Accept", "application/zip, application/octet-stream")
            connection.setRequestProperty("Cache-Control", "no-store")
            val status = connection.responseCode
            if (status in 300..399) {
                connection.disconnect()
                response(502, "Bad Gateway", "CAPWATCH returned a redirect; blocked to protect credentials")
            } else {
                val contentType = connection.contentType?.substringBefore(';') ?: "application/octet-stream"
                val input = if (status >= 400) connection.errorStream ?: ByteArrayInputStream(byteArrayOf()) else connection.inputStream
                val activeConnection = connection!!
                val wrapped = object : FilterInputStream(input) {
                    override fun close() { try { super.close() } finally { activeConnection.disconnect() } }
                }
                WebResourceResponse(contentType, null, status, if (status == 200) "OK" else "CAPWATCH Response",
                    mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"), wrapped)
            }
        } catch (_: Exception) {
            connection?.disconnect()
            response(502, "Bad Gateway", "CAPWATCH connection failed. Check internet and try again")
        }
    }
    private fun response(code: Int, reason: String, text: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason,
            mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(text.toByteArray()))
    private fun blocked() = response(403, "Forbidden", "External resources are blocked")
    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_LONG).show()

    inner class Exports {
        /** App assets are trusted and bundled; no external pages are loaded into this WebView. */
        @JavascriptInterface fun start(filename: String, mime: String): String {
            synchronized(exportGuard) {
                if (exportInProgress != null || exportToSave != null) return ""
                val name = filename.replace(Regex("[^a-zA-Z0-9._-]"), "_").take(100)
                if (name.isBlank()) return ""
                val token = UUID.randomUUID().toString()
                val file = File(cacheDir, "export-$token.tmp")
                if (!file.createNewFile()) return ""
                exportInProgress = ExportJob(token, file, name, mime.take(80))
                return token
            }
        }
        @JavascriptInterface fun write(token: String, base64Chunk: String): Boolean {
            synchronized(exportGuard) {
                val job = exportInProgress ?: return false
                if (job.token != token || job.count > 250L * 1024 * 1024 || base64Chunk.length > 65536) return false
                return try {
                    val chunk = Base64.getDecoder().decode(base64Chunk)
                    if (job.count + chunk.size > 250L * 1024 * 1024) return false
                    job.file.appendBytes(chunk)
                    job.count += chunk.size; true
                } catch (_: Exception) { false }
            }
        }
        @JavascriptInterface fun finish(token: String): Boolean {
            synchronized(exportGuard) {
                val job = exportInProgress ?: return false
                if (job.token != token) return false
                exportInProgress = null
                exportToSave = job
                runOnUiThread {
                    try {
                        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE)
                            .setType(job.mime.substringBefore(';'))
                            .putExtra(Intent.EXTRA_TITLE, job.name)
                        saveLauncher.launch(intent)
                    } catch (_: Exception) { exportToSave = null; job.file.delete(); toast("Cannot select destination") }
                }
                return true
            }
        }
    }
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
    override fun onDestroy() {
        webPermission?.deny()
        exportInProgress?.file?.delete(); exportToSave?.file?.delete()
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
