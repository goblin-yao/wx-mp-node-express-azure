var express = require("express");
var router = express.Router();

const chatgptlib = require("../chatgptlib");

//这个来源是由wx-mp-node项目中的ts文件构建出来的
const chatGPTapi = new chatgptlib.ChatGPTAPI({
  apiKey: process.env.OPENAI_API_KEY,
});
const chatGPTTurboapi = new chatgptlib.ChatGPTAPITURBO({
  apiKey: process.env.OPENAI_API_KEY,
});

function getChatGPTAPI() {
  if (process.env.CHATGPT_MODEL === "gpt-3.5-turbo") {
    return chatGPTTurboapi;
  }
  return Math.random() > 0.5 ? chatGPTTurboapi : chatGPTapi;
}

router.post("/chat", async function (req, res, next) {
  const { question } = req.body;
  // send a message and wait for the response
  let response = { question };
  try {
    response = await getChatGPTAPI().sendMessage(question);
  } catch (error) {
    response.error = error;
  }
  res.send(response);
});

router.get("/getModels", async (req, res) => {
  // send a message and wait for the response
  let response = {};
  try {
    response = await getChatGPTAPI().getModels();
  } catch (error) {
    response.error = error;
  }
  res.send(response);
});

// 小程序调用，获取微信 Open ID
router.get("/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
  }
});
module.exports = router;
