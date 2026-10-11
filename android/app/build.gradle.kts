plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}
android {
  namespace = "org.capinventory.local"
  compileSdk = 35
  defaultConfig {
    applicationId = "org.capinventory.local"
    minSdk = 26
    targetSdk = 35
    versionCode = 4
    versionName = "0.4.0"
  }
  buildTypes {
    release { isMinifyEnabled = false }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}
dependencies {
  implementation("androidx.webkit:webkit:1.12.1")
  implementation("androidx.activity:activity-ktx:1.9.3")
  implementation("androidx.core:core-ktx:1.15.0")
}
