plugins {
    alias(libs.plugins.android.application)
}

android {
    sourceSets {
        // Build the web app straight from the repo (../../prototype) instead of
        // keeping a copy in assets/www. That is what removes the sync step:
        // git pull / Update Project is enough, then press Run.
        getByName("main") {
            assets.srcDirs("../../prototype")
        }
    }
    namespace = "com.qiyu.xctally"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.qiyu.xctally"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            optimization {
                enable = true
                packageScope = setOf("androidx.**", "kotlin.**", "kotlinx.**")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.core.ktx)
    implementation(libs.material)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
}