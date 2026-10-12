export const metadata = {
  title: 'dbdataentry - Webhook & DB Analytics',
  description: 'Advanced Webhook Dashboard and Database Usage Monitor',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style={{
        margin: 0,
        backgroundColor: '#0a0f1d',
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        {children}
      </body>
    </html>
  );
}
