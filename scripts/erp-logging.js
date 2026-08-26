(function () {
  try {
    // Hostname-derived environment flags. Computed once at script load since
    // location.hostname doesn't change during the page's lifetime.
    var IS_DEV_ENV = window.location.hostname === 'localhost';
    var IS_PREPROD_ENV = (function () {
      var hostnamePrefix = window.location.hostname.split('.')[0];
      var preprodPrefixes = ['e2e', 'qa', 'qal', 'stage', 'perfsp'];
      return preprodPrefixes.indexOf(hostnamePrefix) > -1;
    })();
    // ---- Config ----prod: 
    var API_KEY = IS_PREPROD_ENV ? "prdakyresA7MamH8ctx3V0wT0cBlPGamp1ZbRNeX" : "preprdakyresiJuTGrmMMaJq1Bx2fUAz97S5hEdP"
    var CS_LOGGING_APP_ID = "Intuit.gotomarket.expdelactiv.raasclientlogging";
    var CS_LOG_KEY = "Intuit_APIKey intuit_apikey=" + API_KEY + ", intuit_apikey_version=1.0";
    var PROD_LOGGING_ENDPOINT = "https://logging.api.intuit.com/v2/log/message";
    var E2E_LOGGING_ENDPOINT = "https://logging-e2e.api.intuit.com/v2/log/message";
    // ---- Helpers ----
    // Reads a cookie value by name, e.g. readCookie('ivid').
    function readCookie(name) {
      try {
        return document && document.cookie && document.cookie.toString()
          .match(name + '=[^;]*;?')[0].split('=')[1].replace(';', '');
      } catch (err) {
        return '';
      }
    }
    // ivid identifies the visitor; read once and reused everywhere below.
    var IVID = readCookie('ivid');
    // ---- Log dispatch ----
    // Sends the finished log body somewhere:
    //  - localhost: print to console only
    //  - preprod hostnames: POST to the e2e logging endpoint
    //  - everything else: POST to the prod logging endpoint
    // If fetch isn't available, the log is silently dropped (no polyfill/buffering).
    function csLogImpl(level, logBody) {
      if (IS_DEV_ENV) {
        var actualLogBody = JSON.parse(JSON.stringify(logBody));
        var lowerCaseStr = typeof level === "string" ? level.toLowerCase() : level;
        var logFunc = {
          "error": console.error,
          "info": console.info,
          "warn": console.warn,
          "debug": console.debug,
        }[lowerCaseStr] || console.log;
        logFunc("[csLog]", actualLogBody);
      } else {
        if (typeof fetch === 'function') {
          var csLoggingEndpoint = IS_PREPROD_ENV ? E2E_LOGGING_ENDPOINT : PROD_LOGGING_ENDPOINT;
          fetch(csLoggingEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': CS_LOG_KEY,
            },
            body: JSON.stringify(logBody),
          }).catch(function (error) {
            console.log(error);
          });
        }
      }
    }
    // Builds the standard log payload (appId, env, level, timestamp, etc.)
    // and hands it off to csLogImpl.
    function csLog(type, message) {
      var logBody = {
        appId: CS_LOGGING_APP_ID,
        env: IS_PREPROD_ENV ? "preprod" : "prod",
        level: type,
        timestamp: Date.now(),
        userAgent: window.navigator.userAgent,
        oilProps: {
          destination: [CS_LOGGING_APP_ID]
        },
      };
      logBody.message = message;
      csLogImpl(type, logBody);
    }
    // ---- Public logging API: window.coreServiceAdapter.logger.* ----
    if (!window.coreServiceAdapter) {
      window.coreServiceAdapter = {};
    }
    function csaWrappedLogger(level, message, obj) {
      var obj2 = obj || {};
      obj2.message = message || "";
      csLog(level, obj2);
    }
    window.coreServiceAdapter.logger = {};
    window.coreServiceAdapter.logger.info = function (m, e) { csaWrappedLogger('info', m, e); };
    window.coreServiceAdapter.logger.warn = function (m, e) { csaWrappedLogger('warn', m, e); };
    window.coreServiceAdapter.logger.error = function (m, e) { csaWrappedLogger('error', m, e); };
    window.coreServiceAdapter.logger.fatal = function (m, e) { csaWrappedLogger('fatal', m, e); };
    window.coreServiceAdapter.logger.debug = function (m, e) { csaWrappedLogger('debug', m, e); };
    // Entry point for the automatic listeners below.
    function csLoggingUtility(level, msgIdentifier) {
      if (typeof fetch === 'function') {
        csLog(level, msgIdentifier);
      }
    }
    // ---- Automatic capture ----
    // Logs uncaught JS errors on the page.
    window.addEventListener("error", function (event) {
      var message = event.message;
      var string = message.toLowerCase();
      var substring = "script error";
      if (string.indexOf(substring) > -1) {
        // Cross-origin script errors carry no useful detail - skip logging them.
        console.log('Script Error: See Browser Console for Detail');
      } else {
        var msg = [
          'Message: ' + message,
          'URL: ' + event.filename,
          'Line: ' + event.lineno,
          'Column: ' + event.colno,
          'Error object: ' + JSON.stringify(event.error)
        ].join(' - ');
        var msgIdentifier = {
          msg: msg,
          pageUrl: window.location.href,
          userAgent: window.navigator.userAgent,
          ivid: IVID
        };
        csLoggingUtility("error", msgIdentifier);
      }
      return false;
    });
    // Lets other scripts on the page trigger an info log via a custom event:
    //   window.dispatchEvent(new CustomEvent('csInfo', { detail: { message: '...' } }));
    window.addEventListener("csInfo", function (event) {
      var msgIdentifier = {
        msg: event.detail.message,
        pageUrl: window.location.href,
        userAgent: window.navigator.userAgent,
        ivid: IVID
      };
      csLoggingUtility("info", msgIdentifier);
    });
  } catch (err) {
    console.log('Failed to initialize ERP client-side logging: ' + err);
  }
})();
