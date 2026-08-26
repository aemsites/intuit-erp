(() => {
  try {
    // Hostname-derived environment flags. Computed once at script load since
    // location.hostname doesn't change during the page's lifetime.
    const IS_DEV_ENV = window.location.hostname === 'localhost';
    const IS_PREPROD_ENV = (() => {
      const hostnamePrefix = window.location.hostname.split('.')[0];
      return ['e2e', 'qa', 'qal', 'stage', 'perfsp'].includes(hostnamePrefix);
    })();

    // ---- Config ----
    const API_KEY = IS_PREPROD_ENV
      ? 'preprdakyresiJuTGrmMMaJq1Bx2fUAz97S5hEdP'
      : 'prdakyresA7MamH8ctx3V0wT0cBlPGamp1ZbRNeX';
    const CS_LOGGING_APP_ID = 'Intuit.gotomarket.expdelactiv.raasclientlogging';
    const CS_LOG_KEY = `Intuit_APIKey intuit_apikey=${API_KEY}, intuit_apikey_version=1.0`;
    const PROD_LOGGING_ENDPOINT = 'https://logging.api.intuit.com/v2/log/message';
    const E2E_LOGGING_ENDPOINT = 'https://logging-e2e.api.intuit.com/v2/log/message';

    // ---- Helpers ----
    // Reads a cookie value by name, e.g. readCookie('ivid').
    const readCookie = (name) => {
      try {
        return document.cookie.match(`${name}=[^;]*;?`)[0].split('=')[1].replace(';', '');
      } catch (err) {
        return '';
      }
    };
    // ivid identifies the visitor; read once and reused everywhere below.
    const IVID = readCookie('ivid');

    // ---- Log dispatch ----
    // Sends the finished log body somewhere:
    //  - localhost: print to console only
    //  - preprod hostnames: POST to the e2e logging endpoint
    //  - everything else: POST to the prod logging endpoint
    // If fetch isn't available, the log is silently dropped (no polyfill/buffering).
    const csLogImpl = (level, logBody) => {
      if (IS_DEV_ENV) {
        const actualLogBody = JSON.parse(JSON.stringify(logBody));
        const lowerCaseStr = typeof level === 'string' ? level.toLowerCase() : level;
        const logFunc = {
          error: console.error,
          info: console.info,
          warn: console.warn,
          debug: console.debug,
        }[lowerCaseStr] || console.log;
        logFunc('[csLog]', actualLogBody);
      } else if (typeof fetch === 'function') {
        const csLoggingEndpoint = IS_PREPROD_ENV ? E2E_LOGGING_ENDPOINT : PROD_LOGGING_ENDPOINT;
        fetch(csLoggingEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: CS_LOG_KEY,
          },
          body: JSON.stringify(logBody),
        }).catch((error) => {
          console.log(error);
        });
      }
    };

    // Builds the standard log payload (appId, env, level, timestamp, etc.)
    // and hands it off to csLogImpl.
    const csLog = (type, message) => {
      const logBody = {
        appId: CS_LOGGING_APP_ID,
        env: IS_PREPROD_ENV ? 'preprod' : 'prod',
        level: type,
        timestamp: Date.now(),
        userAgent: window.navigator.userAgent,
        oilProps: {
          destination: [CS_LOGGING_APP_ID],
        },
        message,
      };
      csLogImpl(type, logBody);
    };

    // Wraps csLog so callers can pass a plain message plus an optional context object.
    const csaWrappedLogger = (level, message, obj) => {
      const payload = obj || {};
      payload.message = message || '';
      csLog(level, payload);
    };

    // ---- Public logging API: window.coreServiceAdapter.logger.* ----
    if (!window.coreServiceAdapter) {
      window.coreServiceAdapter = {};
    }
    window.coreServiceAdapter.logger = {
      info: (m, e) => csaWrappedLogger('info', m, e),
      warn: (m, e) => csaWrappedLogger('warn', m, e),
      error: (m, e) => csaWrappedLogger('error', m, e),
      fatal: (m, e) => csaWrappedLogger('fatal', m, e),
      debug: (m, e) => csaWrappedLogger('debug', m, e),
    };

    // Entry point for the automatic listeners below.
    const csLoggingUtility = (level, msgIdentifier) => {
      if (typeof fetch === 'function') {
        csLog(level, msgIdentifier);
      }
    };

    // ---- Automatic capture ----
    // Logs uncaught JS errors on the page.
    window.addEventListener('error', (event) => {
      const { message } = event;
      if (message.toLowerCase().includes('script error')) {
        // Cross-origin script errors carry no useful detail - skip logging them.
        console.log('Script Error: See Browser Console for Detail');
      } else {
        const msg = [
          `Message: ${message}`,
          `URL: ${event.filename}`,
          `Line: ${event.lineno}`,
          `Column: ${event.colno}`,
          `Error object: ${JSON.stringify(event.error)}`,
        ].join(' - ');
        csLoggingUtility('error', {
          msg,
          pageUrl: window.location.href,
          userAgent: window.navigator.userAgent,
          ivid: IVID,
        });
      }
      return false;
    });
    // Lets other scripts on the page trigger an info log via a custom event:
    //   window.dispatchEvent(new CustomEvent('csInfo', { detail: { message: '...' } }));
    window.addEventListener('csInfo', (event) => {
      csLoggingUtility('info', {
        msg: event.detail.message,
        pageUrl: window.location.href,
        userAgent: window.navigator.userAgent,
        ivid: IVID,
      });
    });
  } catch (err) {
    console.log(`Failed to initialize ERP client-side logging: ${err}`);
  }
})();
