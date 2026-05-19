/**
 * Custom Document — injects anti-flash script so the correct theme
 * (dark or light) is applied before React hydrates, preventing a
 * white flash when the user has dark mode saved.
 */
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html>
      <Head>
        {/* Viewport explicite : layout responsive, pas de zoom-image, safe area iOS */}
        <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, viewport-fit=cover" />
      </Head>
      <body>
        {/*
          Anti-flash: read theme preference from localStorage and apply
          the `dark` class to <html> synchronously, before the first paint.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('mc-theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
