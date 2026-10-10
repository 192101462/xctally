plugins {
    alias(libs.plugins.android.application)
}

// 网页应用（仓库里的 prototype/）就是本模块的资产目录，不再往工程里复制一份。
// 注意：srcDirs 的相对路径按【模块目录】解析（apps/android/app），
// 所以这里用 rootProject 锚定，避免数错层数——数错时 AGP 不报错，只是资产为空，
// 装出来是一个白屏 App（ERR_INVALID_RESPONSE），非常难查。
val webAssetsDir = rootProject.projectDir.resolve("../../prototype")
require(webAssetsDir.isDirectory) {
    "Web assets not found: $webAssetsDir\n" +
    "Expected the repo layout <repo>/prototype next to <repo>/apps/android. " +
    "Fix the path in apps/android/app/build.gradle.kts or clone the whole repo."
}

android {
    sourceSets {
        getByName("main") {
            assets.srcDirs(webAssetsDir)
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