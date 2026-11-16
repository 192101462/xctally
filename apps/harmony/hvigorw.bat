@if "%DEBUG%" == "" @echo off
@rem ##########################################################################
@rem
@rem  Hvigor startup script for Windows
@rem
@rem ##########################################################################

@rem Set local scope for the variables with windows NT shell
if "%OS%"=="Windows_NT" setlocal EnableDelayedExpansion

set DIRNAME=%~dp0
if "%DIRNAME%" == "" set DIRNAME=.
set APP_BASE_NAME=%~n0
set APP_HOME=%DIRNAME%

@rem Resolve any "." and ".." in APP_HOME to make it shorter.
for %%i in ("%APP_HOME%") do set APP_HOME=%%~fi

set WRAPPER_MODULE_PATH=%DIRNAME%\hvigorw.js
set NODE_EXE=node.exe
@rem set NODE_OPTS="--max-old-space-size=8192 --expose-gc"

@rem JDK resolution: JAVA_HOME first, then bundled JRE
set DEVECO_JAVA_HOME=%APP_HOME%\..\..\tool\jre
set MIN_JAVA_VERSION=21

if defined JAVA_HOME (
    if exist "!JAVA_HOME!\bin\java.exe" (
        for /f "tokens=3" %%i in ('"!JAVA_HOME!\bin\java.exe" -version 2^>^&1') do (
            if not defined java_version set "java_version=%%~i"
        )
        for /f "tokens=1 delims=." %%i in ("!java_version!") do set "major_version=%%i"
        if !major_version! GEQ !MIN_JAVA_VERSION! (
            set PATH=!JAVA_HOME!\bin;!PATH!
        ) else (
            echo WARNING: The currently configured JDK version is too low ^(^< 21^). To ensure compatibility, it has been automatically switched to the embedded JDK 21.
            set PATH=!DEVECO_JAVA_HOME!\bin;!PATH!
        )
    ) else (
        set PATH=!DEVECO_JAVA_HOME!\bin;!PATH!
    )
) else (
    set PATH=!DEVECO_JAVA_HOME!\bin;!PATH!
)

goto start

:start
if not defined NODE_OPTS set NODE_OPTS="--"

@rem Find node.exe - try PATH first
%NODE_EXE% --version >NUL 2>&1
if "%ERRORLEVEL%" == "0" goto execute

@rem Fall back to NODE_HOME
if not defined NODE_HOME goto nodeNotFound
set NODE_HOME=%NODE_HOME:"=%
set NODE_EXE=%NODE_HOME%\%NODE_EXE%
%NODE_EXE% --version >NUL 2>&1
if "%ERRORLEVEL%" == "0" goto execute

:nodeNotFound
echo.
echo ERROR: NODE_HOME is not set and no 'node' command is found in your PATH setting.
echo.
echo Please set the NODE_HOME variable in your environment to match the
echo location of your NodeJs installation.

goto fail

:execute
@rem Execute hvigor
"%NODE_EXE%" "%NODE_OPTS%" "%WRAPPER_MODULE_PATH%" %*

if "%ERRORLEVEL%" == "0" goto hvigorwEnd

:fail
exit /b 1

:hvigorwEnd
if "%OS%" == "Windows_NT" endlocal

:end
