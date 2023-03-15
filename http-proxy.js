const httpProxy = require("http-proxy");
const http = require("http");

// Set up the proxy server
const proxy = httpProxy.createProxyServer({});

// Handle proxy server events
proxy.on("proxyReq", (proxyReq, req, res, options) => {
  // Set the API key in the headers of the request
  // proxyReq.setHeader("Authorization", `Bearer ${process.env.OPENAI_API_KEY}`);
});

proxy.on("proxyRes", (proxyRes, req, res) => {
  // Log the response from the OpenAI API
  console.log(`Received response: ${proxyRes.statusCode}`);
});

// Create the server and listen for requests
const httpProxyServer = http.createServer((req, res) => {
  // Forward the request to the OpenAI API
  proxy.web(req, res, {
    target: "https://api.openai.com",
    changeOrigin: true,
  });
});
module.exports = httpProxyServer;
