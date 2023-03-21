//参考 https://www.npmjs.com/package/express-http-proxy
var proxy = require("express-http-proxy");
function proxyHandler() {
  return proxy("https://api.openai.com", {
    // //过滤器（可选）
    // filter: function(req, res) {
    //     return req.method == 'GET';
    // },
    // //请求路径解析（可选）
    // proxyReqPathResolver: function(req) {
    //         console.log(`请求的路径：${req.url}`);     //请求的路径：/article/list

    //     return `${req.url}?token=123456`        //转发请求路径： /article/list?token=123456
    // },
    // //返回数据处理,如果过程有异步操作应返回Promise（可选）
    // userResDecorator: function(proxyRes, proxyResData, userReq, userRes) {
    //     //同步
    //     data = JSON.parse(proxyResData.toString('utf8'));
    //     data.newProperty = 'exciting data';
    //     return JSON.stringify(data);
    //     //异步
    //     return new Promise(function(resolve) {
    //         proxyResData.funkyMessage = 'oi io oo ii';
    //         setTimeout(function() {
    //             resolve(proxyResData);
    //         }, 200);
    //     });
    // },
    proxyErrorHandler: function (err, res, next) {
      switch (err && err.code) {
        case "ECONNRESET": {
          return res.status(405).send("504 became 405");
        }
        case "ECONNREFUSED": {
          return res.status(200).send("gotcher back");
        }
        default: {
          next(err);
        }
      }
    },
  });
}
module.exports = proxyHandler;
