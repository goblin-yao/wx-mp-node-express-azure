"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatGPTAPITURBO = void 0;
const gpt_3_encoder_1 = require("gpt-3-encoder");
const keyv_1 = __importDefault(require("keyv"));
const p_timeout_1 = __importDefault(require("p-timeout"));
const uuid_1 = require("uuid");
const types = __importStar(require("./types"));
const axios_1 = __importDefault(require("axios"));
const quick_lru_1 = __importDefault(require("quick-lru"));
const config_1 = require("./config");
class ChatGPTAPITURBO {
    constructor(opts) {
        const { apiKey, apiBaseUrl = "https://api.openai.com", apiReverseProxyUrl, debug = false, messageStore, completionParams, maxModelTokens = 4096, maxResponseTokens = 1500, userLabel = config_1.USER_LABEL_DEFAULT, assistantLabel = config_1.ASSISTANT_LABEL_DEFAULT, getMessageById = this._defaultGetMessageById, upsertMessage = this._defaultUpsertMessage, } = opts;
        this._apiKey = apiKey;
        this._apiBaseUrl = apiBaseUrl;
        this._apiReverseProxyUrl = apiReverseProxyUrl;
        this._debug = !!debug;
        this._completionParams = Object.assign({ model: config_1.CHATGPT_MODEL_GPT, temperature: 0.4, top_p: 1.0, presence_penalty: 1.0 }, completionParams);
        if (this._isChatGPTModel) {
            this._endToken = "<|im_end|>";
            this._sepToken = "<|im_sep|>";
            if (!this._completionParams.stop) {
                this._completionParams.stop = [this._endToken, this._sepToken];
            }
        }
        else {
            this._endToken = "<|endoftext|>";
            this._sepToken = this._endToken;
            if (!this._completionParams.stop) {
                this._completionParams.stop = [this._endToken];
            }
        }
        this._maxModelTokens = maxModelTokens;
        this._maxResponseTokens = maxResponseTokens;
        this._userLabel = userLabel;
        this._assistantLabel = assistantLabel;
        this._getMessageById = getMessageById;
        this._upsertMessage = upsertMessage;
        if (messageStore) {
            this._messageStore = messageStore;
        }
        else {
            this._messageStore = new keyv_1.default({
                store: new quick_lru_1.default({ maxSize: 10000 }),
            });
        }
        if (!this._apiKey) {
            throw new Error("ChatGPT invalid apiKey");
        }
    }
    async sendMessage(text, opts = {}) {
        const { conversationId = (0, uuid_1.v4)(), parentMessageId, messageId = (0, uuid_1.v4)(), timeoutMs, onProgress, stream = onProgress ? true : false, } = opts;
        let { abortSignal } = opts;
        let abortController = null;
        if (timeoutMs && !abortSignal) {
            abortController = new AbortController();
            abortSignal = abortController.signal;
        }
        const message = {
            role: "user",
            id: messageId,
            parentMessageId,
            conversationId,
            text,
        };
        await this._upsertMessage(message);
        const { maxTokens } = await this._buildPrompt(text, opts);
        const result = {
            role: "assistant",
            id: (0, uuid_1.v4)(),
            parentMessageId: messageId,
            conversationId,
            text: "",
        };
        const responseP = new Promise(async (resolve, reject) => {
            var _a, _b, _c, _d, _e, _f, _g;
            const url = `${this._apiReverseProxyUrl || this._apiBaseUrl}/v1/chat/completions`;
            const body = Object.assign(Object.assign({ max_tokens: maxTokens }, this._completionParams), { messages: [
                    {
                        role: "system",
                        content: `你是${this._assistantLabel}.使用简洁，拟人化的方式回答问题`,
                    },
                    { role: "user", content: text },
                ], stream });
            console.log("/v1/chat/completions body=>>", JSON.stringify(body));
            try {
                const response = await axios_1.default.post(url, body, {
                    timeout: 60000,
                    headers: {
                        Authorization: `Bearer ${this._apiKey}`,
                    },
                });
                if (200 != response.status) {
                    const msg = `ChatGPT error ${response.status || response.statusText}`;
                    const error = new types.ChatGPTError(msg);
                    error.statusCode = response.status;
                    error.statusText = response.statusText;
                    return reject(error);
                }
                if ((_a = response === null || response === void 0 ? void 0 : response.data) === null || _a === void 0 ? void 0 : _a.id) {
                    result.id = response.data.id;
                }
                console.log("response?.data gpt?=>", response === null || response === void 0 ? void 0 : response.data);
                if ((_c = (_b = response === null || response === void 0 ? void 0 : response.data) === null || _b === void 0 ? void 0 : _b.choices) === null || _c === void 0 ? void 0 : _c.length) {
                    result.text = response.data.choices[0].message.content.trim();
                }
                else {
                    const res = response.data;
                    return reject(new Error(`ChatGPT error: ${((_d = res === null || res === void 0 ? void 0 : res.detail) === null || _d === void 0 ? void 0 : _d.message) || (res === null || res === void 0 ? void 0 : res.detail) || "unknown"}`));
                }
                result.detail = { model: ((_e = response === null || response === void 0 ? void 0 : response.data) === null || _e === void 0 ? void 0 : _e.model) || "" };
                console.log("==>result>", result);
                return resolve(result);
            }
            catch (error) {
                console.log("error gpt=>", error);
                return reject({
                    statusCode: ((_f = error === null || error === void 0 ? void 0 : error.response) === null || _f === void 0 ? void 0 : _f.status) || -1002,
                    data: ((_g = error === null || error === void 0 ? void 0 : error.response) === null || _g === void 0 ? void 0 : _g.data) || "服务内部错误",
                });
            }
        }).then((message) => {
            return this._upsertMessage(message).then(() => message);
        });
        if (timeoutMs) {
            if (abortController) {
                responseP.cancel = () => {
                    abortController.abort();
                };
            }
            return (0, p_timeout_1.default)(responseP, timeoutMs, "ChatGPT timed out waiting for response");
        }
        else {
            return responseP;
        }
    }
    async getModels() {
        return new Promise(async (resolve, reject) => {
            const url = `${this._apiReverseProxyUrl || this._apiBaseUrl}/v1/models`;
            try {
                const response = await axios_1.default.get(url, {
                    timeout: 60000,
                    headers: {
                        Authorization: `Bearer ${this._apiKey}`,
                    },
                });
                return resolve(response.data);
            }
            catch (error) {
                return reject({
                    data: error.response.data,
                });
            }
        });
    }
    get apiKey() {
        return this._apiKey;
    }
    set apiKey(apiKey) {
        this._apiKey = apiKey;
    }
    async _buildPrompt(message, opts) {
        const promptPrefix = opts.promptPrefix || ``;
        const promptSuffix = opts.promptSuffix || `\n\n${this._assistantLabel}:\n`;
        const maxNumTokens = this._maxModelTokens - this._maxResponseTokens;
        let { parentMessageId } = opts;
        let nextPromptBody = `${this._userLabel}:\n\n${message}${this._endToken}`;
        let promptBody = "";
        let prompt;
        let numTokens;
        do {
            const nextPrompt = `${promptPrefix}${nextPromptBody}${promptSuffix}`;
            const nextNumTokens = await this._getTokenCount(nextPrompt);
            const isValidPrompt = nextNumTokens <= maxNumTokens;
            if (prompt && !isValidPrompt) {
                break;
            }
            promptBody = nextPromptBody;
            prompt = nextPrompt;
            numTokens = nextNumTokens;
            if (!isValidPrompt) {
                break;
            }
            if (!parentMessageId) {
                break;
            }
            const parentMessage = await this._getMessageById(parentMessageId);
            if (!parentMessage) {
                break;
            }
            const parentMessageRole = parentMessage.role || "user";
            const parentMessageRoleDesc = parentMessageRole === "user" ? this._userLabel : this._assistantLabel;
            const parentMessageString = `${parentMessageRoleDesc}:\n\n${parentMessage.text}${this._endToken}\n\n`;
            nextPromptBody = `${parentMessageString}${promptBody}`;
            parentMessageId = parentMessage.parentMessageId;
        } while (true);
        const maxTokens = Math.max(1, Math.min(this._maxModelTokens - numTokens, this._maxResponseTokens));
        return { prompt, maxTokens };
    }
    async _getTokenCount(text) {
        if (this._isChatGPTModel) {
            text = text.replace(/<\|im_end\|>/g, "<|endoftext|>");
            text = text.replace(/<\|im_sep\|>/g, "<|endoftext|>");
        }
        return (0, gpt_3_encoder_1.encode)(text).length;
    }
    get _isChatGPTModel() {
        return (this._completionParams.model.startsWith("text-chat") ||
            this._completionParams.model.startsWith("text-davinci-002-render") ||
            this._completionParams.model.startsWith("gpt-"));
    }
    async _defaultGetMessageById(id) {
        const res = await this._messageStore.get(id);
        console.log("getMessageById", id, res);
        return res;
    }
    async _defaultUpsertMessage(message) {
        await this._messageStore.set(message.id, message);
    }
}
exports.ChatGPTAPITURBO = ChatGPTAPITURBO;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2hhdGdwdC1hcGktZ3B0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vY2hhdGdwdGxpYl9zcmMvY2hhdGdwdC1hcGktZ3B0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW9EO0FBQ3BELGdEQUF3QjtBQUN4QiwwREFBaUM7QUFDakMsK0JBQW9DO0FBRXBDLCtDQUFpQztBQUNqQyxrREFBMEI7QUFFMUIsMERBQWlDO0FBRWpDLHFDQUlrQjtBQUVsQixNQUFhLGVBQWU7SUFrQzFCLFlBQVksSUE2Qlg7UUFDQyxNQUFNLEVBQ0osTUFBTSxFQUNOLFVBQVUsR0FBRyx3QkFBd0IsRUFDckMsa0JBQWtCLEVBQ2xCLEtBQUssR0FBRyxLQUFLLEVBQ2IsWUFBWSxFQUNaLGdCQUFnQixFQUNoQixjQUFjLEdBQUcsSUFBSSxFQUNyQixpQkFBaUIsR0FBRyxJQUFJLEVBQ3hCLFNBQVMsR0FBRywyQkFBa0IsRUFDOUIsY0FBYyxHQUFHLGdDQUF1QixFQUN4QyxjQUFjLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixFQUM1QyxhQUFhLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixHQUMzQyxHQUFHLElBQUksQ0FBQztRQUVULElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDO1FBQ3RCLElBQUksQ0FBQyxXQUFXLEdBQUcsVUFBVSxDQUFDO1FBQzlCLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxrQkFBa0IsQ0FBQztRQUM5QyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUM7UUFFdEIsSUFBSSxDQUFDLGlCQUFpQixtQkFDcEIsS0FBSyxFQUFFLDBCQUFpQixFQUN4QixXQUFXLEVBQUUsR0FBRyxFQUNoQixLQUFLLEVBQUUsR0FBRyxFQUNWLGdCQUFnQixFQUFFLEdBQUcsSUFDbEIsZ0JBQWdCLENBQ3BCLENBQUM7UUFFRixJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUU7WUFDeEIsSUFBSSxDQUFDLFNBQVMsR0FBRyxZQUFZLENBQUM7WUFDOUIsSUFBSSxDQUFDLFNBQVMsR0FBRyxZQUFZLENBQUM7WUFFOUIsSUFBSSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEVBQUU7Z0JBQ2hDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQzthQUNoRTtTQUNGO2FBQU07WUFDTCxJQUFJLENBQUMsU0FBUyxHQUFHLGVBQWUsQ0FBQztZQUNqQyxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUM7WUFFaEMsSUFBSSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEVBQUU7Z0JBQ2hDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7YUFDaEQ7U0FDRjtRQUVELElBQUksQ0FBQyxlQUFlLEdBQUcsY0FBYyxDQUFDO1FBQ3RDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxpQkFBaUIsQ0FBQztRQUM1QyxJQUFJLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQztRQUM1QixJQUFJLENBQUMsZUFBZSxHQUFHLGNBQWMsQ0FBQztRQUV0QyxJQUFJLENBQUMsZUFBZSxHQUFHLGNBQWMsQ0FBQztRQUN0QyxJQUFJLENBQUMsY0FBYyxHQUFHLGFBQWEsQ0FBQztRQUVwQyxJQUFJLFlBQVksRUFBRTtZQUNoQixJQUFJLENBQUMsYUFBYSxHQUFHLFlBQVksQ0FBQztTQUNuQzthQUFNO1lBQ0wsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLGNBQUksQ0FBeUI7Z0JBQ3BELEtBQUssRUFBRSxJQUFJLG1CQUFRLENBQTRCLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxDQUFDO2FBQ25FLENBQUMsQ0FBQztTQUNKO1FBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUU7WUFDakIsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDO1NBQzNDO0lBQ0gsQ0FBQztJQTBCRCxLQUFLLENBQUMsV0FBVyxDQUNmLElBQVksRUFDWixPQUFpQyxFQUFFO1FBRW5DLE1BQU0sRUFDSixjQUFjLEdBQUcsSUFBQSxTQUFNLEdBQUUsRUFDekIsZUFBZSxFQUNmLFNBQVMsR0FBRyxJQUFBLFNBQU0sR0FBRSxFQUNwQixTQUFTLEVBQ1QsVUFBVSxFQUNWLE1BQU0sR0FBRyxVQUFVLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsS0FBSyxHQUNuQyxHQUFHLElBQUksQ0FBQztRQUVULElBQUksRUFBRSxXQUFXLEVBQUUsR0FBRyxJQUFJLENBQUM7UUFFM0IsSUFBSSxlQUFlLEdBQW9CLElBQUksQ0FBQztRQUM1QyxJQUFJLFNBQVMsSUFBSSxDQUFDLFdBQVcsRUFBRTtZQUM3QixlQUFlLEdBQUcsSUFBSSxlQUFlLEVBQUUsQ0FBQztZQUN4QyxXQUFXLEdBQUcsZUFBZSxDQUFDLE1BQU0sQ0FBQztTQUN0QztRQUVELE1BQU0sT0FBTyxHQUFzQjtZQUNqQyxJQUFJLEVBQUUsTUFBTTtZQUNaLEVBQUUsRUFBRSxTQUFTO1lBQ2IsZUFBZTtZQUNmLGNBQWM7WUFDZCxJQUFJO1NBQ0wsQ0FBQztRQUNGLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUVuQyxNQUFNLEVBQUUsU0FBUyxFQUFFLEdBQUcsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztRQUMxRCxNQUFNLE1BQU0sR0FBc0I7WUFDaEMsSUFBSSxFQUFFLFdBQVc7WUFDakIsRUFBRSxFQUFFLElBQUEsU0FBTSxHQUFFO1lBQ1osZUFBZSxFQUFFLFNBQVM7WUFDMUIsY0FBYztZQUNkLElBQUksRUFBRSxFQUFFO1NBQ1QsQ0FBQztRQUVGLE1BQU0sU0FBUyxHQUFHLElBQUksT0FBTyxDQUMzQixLQUFLLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFOztZQUN4QixNQUFNLEdBQUcsR0FBRyxHQUNWLElBQUksQ0FBQyxtQkFBbUIsSUFBSSxJQUFJLENBQUMsV0FDbkMsc0JBQXNCLENBQUM7WUFFdkIsTUFBTSxJQUFJLGlDQUNSLFVBQVUsRUFBRSxTQUFTLElBQ2xCLElBQUksQ0FBQyxpQkFBaUIsS0FDekIsUUFBUSxFQUFFO29CQUNSO3dCQUNFLElBQUksRUFBRSxRQUFRO3dCQUNkLE9BQU8sRUFBRSxLQUFLLElBQUksQ0FBQyxlQUFlLGtCQUFrQjtxQkFDckQ7b0JBQ0QsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUU7aUJBQ2hDLEVBQ0QsTUFBTSxHQUNQLENBQUM7WUFDRixPQUFPLENBQUMsR0FBRyxDQUFDLDhCQUE4QixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztZQUVsRSxJQUFJO2dCQUNGLE1BQU0sUUFBUSxHQUFHLE1BQU0sZUFBSyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxFQUFFO29CQUMzQyxPQUFPLEVBQUUsS0FBSztvQkFDZCxPQUFPLEVBQUU7d0JBQ1AsYUFBYSxFQUFFLFVBQVUsSUFBSSxDQUFDLE9BQU8sRUFBRTtxQkFDeEM7aUJBQ0YsQ0FBQyxDQUFDO2dCQUVILElBQUksR0FBRyxJQUFJLFFBQVEsQ0FBQyxNQUFNLEVBQUU7b0JBQzFCLE1BQU0sR0FBRyxHQUFHLGlCQUNWLFFBQVEsQ0FBQyxNQUFNLElBQUksUUFBUSxDQUFDLFVBQzlCLEVBQUUsQ0FBQztvQkFDSCxNQUFNLEtBQUssR0FBRyxJQUFJLEtBQUssQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQzFDLEtBQUssQ0FBQyxVQUFVLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQztvQkFDbkMsS0FBSyxDQUFDLFVBQVUsR0FBRyxRQUFRLENBQUMsVUFBVSxDQUFDO29CQUN2QyxPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztpQkFDdEI7Z0JBRUQsSUFBSSxNQUFBLFFBQVEsYUFBUixRQUFRLHVCQUFSLFFBQVEsQ0FBRSxJQUFJLDBDQUFFLEVBQUUsRUFBRTtvQkFDdEIsTUFBTSxDQUFDLEVBQUUsR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztpQkFDOUI7Z0JBQ0QsT0FBTyxDQUFDLEdBQUcsQ0FBQyx1QkFBdUIsRUFBRSxRQUFRLGFBQVIsUUFBUSx1QkFBUixRQUFRLENBQUUsSUFBSSxDQUFDLENBQUM7Z0JBQ3JELElBQUksTUFBQSxNQUFBLFFBQVEsYUFBUixRQUFRLHVCQUFSLFFBQVEsQ0FBRSxJQUFJLDBDQUFFLE9BQU8sMENBQUUsTUFBTSxFQUFFO29CQUNuQyxNQUFNLENBQUMsSUFBSSxHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUM7aUJBQy9EO3FCQUFNO29CQUNMLE1BQU0sR0FBRyxHQUFHLFFBQVEsQ0FBQyxJQUFXLENBQUM7b0JBQ2pDLE9BQU8sTUFBTSxDQUNYLElBQUksS0FBSyxDQUNQLGtCQUNFLENBQUEsTUFBQSxHQUFHLGFBQUgsR0FBRyx1QkFBSCxHQUFHLENBQUUsTUFBTSwwQ0FBRSxPQUFPLE1BQUksR0FBRyxhQUFILEdBQUcsdUJBQUgsR0FBRyxDQUFFLE1BQU0sQ0FBQSxJQUFJLFNBQ3pDLEVBQUUsQ0FDSCxDQUNGLENBQUM7aUJBQ0g7Z0JBRUQsTUFBTSxDQUFDLE1BQU0sR0FBRyxFQUFFLEtBQUssRUFBRSxDQUFBLE1BQUEsUUFBUSxhQUFSLFFBQVEsdUJBQVIsUUFBUSxDQUFFLElBQUksMENBQUUsS0FBSyxLQUFJLEVBQUUsRUFBRSxDQUFDO2dCQUV2RCxPQUFPLENBQUMsR0FBRyxDQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsQ0FBQztnQkFFbEMsT0FBTyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7YUFDeEI7WUFBQyxPQUFPLEtBQUssRUFBRTtnQkFDZCxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsQ0FBQztnQkFDbEMsT0FBTyxNQUFNLENBQUM7b0JBQ1osVUFBVSxFQUFFLENBQUEsTUFBQSxLQUFLLGFBQUwsS0FBSyx1QkFBTCxLQUFLLENBQUUsUUFBUSwwQ0FBRSxNQUFNLEtBQUksQ0FBQyxJQUFJO29CQUM1QyxJQUFJLEVBQUUsQ0FBQSxNQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxRQUFRLDBDQUFFLElBQUksS0FBSSxRQUFRO2lCQUN4QyxDQUFDLENBQUM7YUFDSjtRQUNILENBQUMsQ0FDRixDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFO1lBQ2pCLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDMUQsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFJLFNBQVMsRUFBRTtZQUNiLElBQUksZUFBZSxFQUFFO2dCQUdsQixTQUFpQixDQUFDLE1BQU0sR0FBRyxHQUFHLEVBQUU7b0JBQy9CLGVBQWUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztnQkFDMUIsQ0FBQyxDQUFDO2FBQ0g7WUFFRCxPQUFPLElBQUEsbUJBQVEsRUFDYixTQUFTLEVBQ1QsU0FBUyxFQUNULHdDQUF3QyxDQUN6QyxDQUFDO1NBQ0g7YUFBTTtZQUNMLE9BQU8sU0FBUyxDQUFDO1NBQ2xCO0lBQ0gsQ0FBQztJQUlELEtBQUssQ0FBQyxTQUFTO1FBQ2IsT0FBTyxJQUFJLE9BQU8sQ0FBb0IsS0FBSyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUM5RCxNQUFNLEdBQUcsR0FBRyxHQUFHLElBQUksQ0FBQyxtQkFBbUIsSUFBSSxJQUFJLENBQUMsV0FBVyxZQUFZLENBQUM7WUFFeEUsSUFBSTtnQkFDRixNQUFNLFFBQVEsR0FBRyxNQUFNLGVBQUssQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFO29CQUNwQyxPQUFPLEVBQUUsS0FBSztvQkFDZCxPQUFPLEVBQUU7d0JBQ1AsYUFBYSxFQUFFLFVBQVUsSUFBSSxDQUFDLE9BQU8sRUFBRTtxQkFDeEM7aUJBQ0YsQ0FBQyxDQUFDO2dCQUVILE9BQU8sT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQzthQUMvQjtZQUFDLE9BQU8sS0FBSyxFQUFFO2dCQUNkLE9BQU8sTUFBTSxDQUFDO29CQUNaLElBQUksRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUk7aUJBQzFCLENBQUMsQ0FBQzthQUNKO1FBQ0gsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsSUFBSSxNQUFNO1FBQ1IsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDO0lBQ3RCLENBQUM7SUFFRCxJQUFJLE1BQU0sQ0FBQyxNQUFjO1FBQ3ZCLElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDO0lBQ3hCLENBQUM7SUFFUyxLQUFLLENBQUMsWUFBWSxDQUMxQixPQUFlLEVBQ2YsSUFBOEI7UUFXOUIsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLFlBQVksSUFBSSxFQUFFLENBQUM7UUFJN0MsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLFlBQVksSUFBSSxPQUFPLElBQUksQ0FBQyxlQUFlLEtBQUssQ0FBQztRQUUzRSxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQztRQUNwRSxJQUFJLEVBQUUsZUFBZSxFQUFFLEdBQUcsSUFBSSxDQUFDO1FBQy9CLElBQUksY0FBYyxHQUFHLEdBQUcsSUFBSSxDQUFDLFVBQVUsUUFBUSxPQUFPLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQzFFLElBQUksVUFBVSxHQUFHLEVBQUUsQ0FBQztRQUNwQixJQUFJLE1BQWMsQ0FBQztRQUNuQixJQUFJLFNBQWlCLENBQUM7UUFFdEIsR0FBRztZQUNELE1BQU0sVUFBVSxHQUFHLEdBQUcsWUFBWSxHQUFHLGNBQWMsR0FBRyxZQUFZLEVBQUUsQ0FBQztZQUNyRSxNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDNUQsTUFBTSxhQUFhLEdBQUcsYUFBYSxJQUFJLFlBQVksQ0FBQztZQUVwRCxJQUFJLE1BQU0sSUFBSSxDQUFDLGFBQWEsRUFBRTtnQkFDNUIsTUFBTTthQUNQO1lBRUQsVUFBVSxHQUFHLGNBQWMsQ0FBQztZQUM1QixNQUFNLEdBQUcsVUFBVSxDQUFDO1lBQ3BCLFNBQVMsR0FBRyxhQUFhLENBQUM7WUFFMUIsSUFBSSxDQUFDLGFBQWEsRUFBRTtnQkFDbEIsTUFBTTthQUNQO1lBRUQsSUFBSSxDQUFDLGVBQWUsRUFBRTtnQkFDcEIsTUFBTTthQUNQO1lBRUQsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1lBQ2xFLElBQUksQ0FBQyxhQUFhLEVBQUU7Z0JBQ2xCLE1BQU07YUFDUDtZQUVELE1BQU0saUJBQWlCLEdBQUcsYUFBYSxDQUFDLElBQUksSUFBSSxNQUFNLENBQUM7WUFDdkQsTUFBTSxxQkFBcUIsR0FDekIsaUJBQWlCLEtBQUssTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDO1lBR3hFLE1BQU0sbUJBQW1CLEdBQUcsR0FBRyxxQkFBcUIsUUFBUSxhQUFhLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxTQUFTLE1BQU0sQ0FBQztZQUN0RyxjQUFjLEdBQUcsR0FBRyxtQkFBbUIsR0FBRyxVQUFVLEVBQUUsQ0FBQztZQUN2RCxlQUFlLEdBQUcsYUFBYSxDQUFDLGVBQWUsQ0FBQztTQUNqRCxRQUFRLElBQUksRUFBRTtRQUlmLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQ3hCLENBQUMsRUFDRCxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxlQUFlLEdBQUcsU0FBUyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUNwRSxDQUFDO1FBQ0YsT0FBTyxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsQ0FBQztJQUMvQixDQUFDO0lBRVMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxJQUFZO1FBQ3pDLElBQUksSUFBSSxDQUFDLGVBQWUsRUFBRTtZQUd4QixJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxlQUFlLEVBQUUsZUFBZSxDQUFDLENBQUM7WUFDdEQsSUFBSSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsZUFBZSxFQUFFLGVBQWUsQ0FBQyxDQUFDO1NBQ3ZEO1FBRUQsT0FBTyxJQUFBLHNCQUFTLEVBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDO0lBQ2hDLENBQUM7SUFFRCxJQUFjLGVBQWU7UUFDM0IsT0FBTyxDQUNMLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQztZQUNwRCxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyx5QkFBeUIsQ0FBQztZQUNsRSxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FDaEQsQ0FBQztJQUNKLENBQUM7SUFFUyxLQUFLLENBQUMsc0JBQXNCLENBQ3BDLEVBQVU7UUFFVixNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQzdDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLEVBQUUsRUFBRSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ3ZDLE9BQU8sR0FBRyxDQUFDO0lBQ2IsQ0FBQztJQUVTLEtBQUssQ0FBQyxxQkFBcUIsQ0FDbkMsT0FBMEI7UUFHMUIsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ3BELENBQUM7Q0FDRjtBQWxhRCwwQ0FrYUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBlbmNvZGUgYXMgZ3B0RW5jb2RlIH0gZnJvbSBcImdwdC0zLWVuY29kZXJcIjtcbmltcG9ydCBLZXl2IGZyb20gXCJrZXl2XCI7XG5pbXBvcnQgcFRpbWVvdXQgZnJvbSBcInAtdGltZW91dFwiO1xuaW1wb3J0IHsgdjQgYXMgdXVpZHY0IH0gZnJvbSBcInV1aWRcIjtcblxuaW1wb3J0ICogYXMgdHlwZXMgZnJvbSBcIi4vdHlwZXNcIjtcbmltcG9ydCBheGlvcyBmcm9tIFwiYXhpb3NcIjtcblxuaW1wb3J0IFF1aWNrTFJVIGZyb20gXCJxdWljay1scnVcIjtcblxuaW1wb3J0IHtcbiAgQ0hBVEdQVF9NT0RFTF9HUFQsXG4gIFVTRVJfTEFCRUxfREVGQVVMVCxcbiAgQVNTSVNUQU5UX0xBQkVMX0RFRkFVTFQsXG59IGZyb20gXCIuL2NvbmZpZ1wiO1xuXG5leHBvcnQgY2xhc3MgQ2hhdEdQVEFQSVRVUkJPIHtcbiAgcHJvdGVjdGVkIF9hcGlLZXk6IHN0cmluZztcbiAgcHJvdGVjdGVkIF9hcGlCYXNlVXJsOiBzdHJpbmc7XG4gIHByb3RlY3RlZCBfYXBpUmV2ZXJzZVByb3h5VXJsOiBzdHJpbmc7XG4gIHByb3RlY3RlZCBfZGVidWc6IGJvb2xlYW47XG5cbiAgcHJvdGVjdGVkIF9jb21wbGV0aW9uUGFyYW1zOiBPbWl0PHR5cGVzLm9wZW5haS5Db21wbGV0aW9uUGFyYW1zLCBcInByb21wdFwiPjtcbiAgcHJvdGVjdGVkIF9tYXhNb2RlbFRva2VuczogbnVtYmVyO1xuICBwcm90ZWN0ZWQgX21heFJlc3BvbnNlVG9rZW5zOiBudW1iZXI7XG4gIHByb3RlY3RlZCBfdXNlckxhYmVsOiBzdHJpbmc7XG4gIHByb3RlY3RlZCBfYXNzaXN0YW50TGFiZWw6IHN0cmluZztcbiAgcHJvdGVjdGVkIF9lbmRUb2tlbjogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX3NlcFRva2VuOiBzdHJpbmc7XG5cbiAgcHJvdGVjdGVkIF9nZXRNZXNzYWdlQnlJZDogdHlwZXMuR2V0TWVzc2FnZUJ5SWRGdW5jdGlvbjtcbiAgcHJvdGVjdGVkIF91cHNlcnRNZXNzYWdlOiB0eXBlcy5VcHNlcnRNZXNzYWdlRnVuY3Rpb247XG5cbiAgcHJvdGVjdGVkIF9tZXNzYWdlU3RvcmU6IEtleXY8dHlwZXMuQ2hhdE1lc3NhZ2U+O1xuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGNsaWVudCB3cmFwcGVyIGFyb3VuZCBPcGVuQUkncyBjb21wbGV0aW9uIEFQSSB1c2luZyB0aGVcbiAgICogdW5vZmZpY2lhbCBDaGF0R1BUIG1vZGVsLlxuICAgKlxuICAgKiBAcGFyYW0gYXBpS2V5IC0gT3BlbkFJIEFQSSBrZXkgKHJlcXVpcmVkKS5cbiAgICogQHBhcmFtIGFwaUJhc2VVcmwgLSBPcHRpb25hbCBvdmVycmlkZSBmb3IgdGhlIE9wZW5BSSBBUEkgYmFzZSBVUkwuXG4gICAqIEBwYXJhbSBhcGlSZXZlcnNlUHJveHlVcmwgLSBPcHRpb25hbCBvdmVycmlkZSBmb3IgYSByZXZlcnNlIHByb3h5IFVSTCB0byB1c2UgaW5zdGVhZCBvZiB0aGUgT3BlbkFJIEFQSSBjb21wbGV0aW9ucyBBUEkuXG4gICAqIEBwYXJhbSBkZWJ1ZyAtIE9wdGlvbmFsIGVuYWJsZXMgbG9nZ2luZyBkZWJ1Z2dpbmcgaW5mbyB0byBzdGRvdXQuXG4gICAqIEBwYXJhbSBjb21wbGV0aW9uUGFyYW1zIC0gUGFyYW0gb3ZlcnJpZGVzIHRvIHNlbmQgdG8gdGhlIFtPcGVuQUkgY29tcGxldGlvbiBBUEldKGh0dHBzOi8vcGxhdGZvcm0ub3BlbmFpLmNvbS9kb2NzL2FwaS1yZWZlcmVuY2UvY29tcGxldGlvbnMvY3JlYXRlKS4gT3B0aW9ucyBsaWtlIGB0ZW1wZXJhdHVyZWAgYW5kIGBwcmVzZW5jZV9wZW5hbHR5YCBjYW4gYmUgdHdlYWtlZCB0byBjaGFuZ2UgdGhlIHBlcnNvbmFsaXR5IG9mIHRoZSBhc3Npc3RhbnQuXG4gICAqIEBwYXJhbSBtYXhNb2RlbFRva2VucyAtIE9wdGlvbmFsIG92ZXJyaWRlIGZvciB0aGUgbWF4aW11bSBudW1iZXIgb2YgdG9rZW5zIGFsbG93ZWQgYnkgdGhlIG1vZGVsJ3MgY29udGV4dC4gRGVmYXVsdHMgdG8gNDA5NiBmb3IgdGhlIGB0ZXh0LWNoYXQtZGF2aW5jaS0wMDItMjAyMzAxMjZgIG1vZGVsLlxuICAgKiBAcGFyYW0gbWF4UmVzcG9uc2VUb2tlbnMgLSBPcHRpb25hbCBvdmVycmlkZSBmb3IgdGhlIG1pbmltdW0gbnVtYmVyIG9mIHRva2VucyBhbGxvd2VkIGZvciB0aGUgbW9kZWwncyByZXNwb25zZS4gRGVmYXVsdHMgdG8gMTAwMCBmb3IgdGhlIGB0ZXh0LWNoYXQtZGF2aW5jaS0wMDItMjAyMzAxMjZgIG1vZGVsLlxuICAgKiBAcGFyYW0gbWVzc2FnZVN0b3JlIC0gT3B0aW9uYWwgW0tleXZdKGh0dHBzOi8vZ2l0aHViLmNvbS9qYXJlZHdyYXkva2V5dikgc3RvcmUgdG8gcGVyc2lzdCBjaGF0IG1lc3NhZ2VzIHRvLiBJZiBub3QgcHJvdmlkZWQsIG1lc3NhZ2VzIHdpbGwgYmUgbG9zdCB3aGVuIHRoZSBwcm9jZXNzIGV4aXRzLlxuICAgKiBAcGFyYW0gZ2V0TWVzc2FnZUJ5SWQgLSBPcHRpb25hbCBmdW5jdGlvbiB0byByZXRyaWV2ZSBhIG1lc3NhZ2UgYnkgaXRzIElELiBJZiBub3QgcHJvdmlkZWQsIHRoZSBkZWZhdWx0IGltcGxlbWVudGF0aW9uIHdpbGwgYmUgdXNlZCAodXNpbmcgYW4gaW4tbWVtb3J5IGBtZXNzYWdlU3RvcmVgKS5cbiAgICogQHBhcmFtIHVwc2VydE1lc3NhZ2UgLSBPcHRpb25hbCBmdW5jdGlvbiB0byBpbnNlcnQgb3IgdXBkYXRlIGEgbWVzc2FnZS4gSWYgbm90IHByb3ZpZGVkLCB0aGUgZGVmYXVsdCBpbXBsZW1lbnRhdGlvbiB3aWxsIGJlIHVzZWQgKHVzaW5nIGFuIGluLW1lbW9yeSBgbWVzc2FnZVN0b3JlYCkuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihvcHRzOiB7XG4gICAgYXBpS2V5OiBzdHJpbmc7XG5cbiAgICAvKiogQGRlZmF1bHRWYWx1ZSBgJ2h0dHBzOi8vYXBpLm9wZW5haS5jb20nYCAqKi9cbiAgICBhcGlCYXNlVXJsPzogc3RyaW5nO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYHVuZGVmaW5lZGAgKiovXG4gICAgYXBpUmV2ZXJzZVByb3h5VXJsPzogc3RyaW5nO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYGZhbHNlYCAqKi9cbiAgICBkZWJ1Zz86IGJvb2xlYW47XG5cbiAgICBjb21wbGV0aW9uUGFyYW1zPzogUGFydGlhbDx0eXBlcy5vcGVuYWkuQ29tcGxldGlvblBhcmFtcz47XG5cbiAgICAvKiogQGRlZmF1bHRWYWx1ZSBgNDA5NmAgKiovXG4gICAgbWF4TW9kZWxUb2tlbnM/OiBudW1iZXI7XG5cbiAgICAvKiogQGRlZmF1bHRWYWx1ZSBgMTAwMGAgKiovXG4gICAgbWF4UmVzcG9uc2VUb2tlbnM/OiBudW1iZXI7XG5cbiAgICAvKiogQGRlZmF1bHRWYWx1ZSBgJ1VzZXInYCAqKi9cbiAgICB1c2VyTGFiZWw/OiBzdHJpbmc7XG5cbiAgICAvKiogQGRlZmF1bHRWYWx1ZSBgJ0NoYXRHUFQnYCAqKi9cbiAgICBhc3Npc3RhbnRMYWJlbD86IHN0cmluZztcblxuICAgIG1lc3NhZ2VTdG9yZT86IEtleXY7XG4gICAgZ2V0TWVzc2FnZUJ5SWQ/OiB0eXBlcy5HZXRNZXNzYWdlQnlJZEZ1bmN0aW9uO1xuICAgIHVwc2VydE1lc3NhZ2U/OiB0eXBlcy5VcHNlcnRNZXNzYWdlRnVuY3Rpb247XG4gIH0pIHtcbiAgICBjb25zdCB7XG4gICAgICBhcGlLZXksXG4gICAgICBhcGlCYXNlVXJsID0gXCJodHRwczovL2FwaS5vcGVuYWkuY29tXCIsXG4gICAgICBhcGlSZXZlcnNlUHJveHlVcmwsXG4gICAgICBkZWJ1ZyA9IGZhbHNlLFxuICAgICAgbWVzc2FnZVN0b3JlLFxuICAgICAgY29tcGxldGlvblBhcmFtcyxcbiAgICAgIG1heE1vZGVsVG9rZW5zID0gNDA5NiwgLy80MDk2XG4gICAgICBtYXhSZXNwb25zZVRva2VucyA9IDE1MDAsIC8vMTAwMFxuICAgICAgdXNlckxhYmVsID0gVVNFUl9MQUJFTF9ERUZBVUxULFxuICAgICAgYXNzaXN0YW50TGFiZWwgPSBBU1NJU1RBTlRfTEFCRUxfREVGQVVMVCxcbiAgICAgIGdldE1lc3NhZ2VCeUlkID0gdGhpcy5fZGVmYXVsdEdldE1lc3NhZ2VCeUlkLFxuICAgICAgdXBzZXJ0TWVzc2FnZSA9IHRoaXMuX2RlZmF1bHRVcHNlcnRNZXNzYWdlLFxuICAgIH0gPSBvcHRzO1xuXG4gICAgdGhpcy5fYXBpS2V5ID0gYXBpS2V5O1xuICAgIHRoaXMuX2FwaUJhc2VVcmwgPSBhcGlCYXNlVXJsO1xuICAgIHRoaXMuX2FwaVJldmVyc2VQcm94eVVybCA9IGFwaVJldmVyc2VQcm94eVVybDtcbiAgICB0aGlzLl9kZWJ1ZyA9ICEhZGVidWc7XG5cbiAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zID0ge1xuICAgICAgbW9kZWw6IENIQVRHUFRfTU9ERUxfR1BULFxuICAgICAgdGVtcGVyYXR1cmU6IDAuNCwgLy8gMC4yIOS9v+eUqOS7gOS5iOmHh+agt+a4qeW6pu+8jOS7i+S6jiAwIOWSjCAyIOS5i+mXtOOAgui+g+mrmOeahOWAvO+8iOWmgiAwLjjvvInlsIbkvb/ovpPlh7rmm7TliqDpmo/mnLrvvIzogIzovoPkvY7nmoTlgLzvvIjlpoIgMC4y77yJ5bCG5L2/6L6T5Ye65pu05Yqg6ZuG5Lit5ZKM56Gu5a6a44CCXG4gICAgICB0b3BfcDogMS4wLFxuICAgICAgcHJlc2VuY2VfcGVuYWx0eTogMS4wLFxuICAgICAgLi4uY29tcGxldGlvblBhcmFtcyxcbiAgICB9O1xuXG4gICAgaWYgKHRoaXMuX2lzQ2hhdEdQVE1vZGVsKSB7XG4gICAgICB0aGlzLl9lbmRUb2tlbiA9IFwiPHxpbV9lbmR8PlwiO1xuICAgICAgdGhpcy5fc2VwVG9rZW4gPSBcIjx8aW1fc2VwfD5cIjtcblxuICAgICAgaWYgKCF0aGlzLl9jb21wbGV0aW9uUGFyYW1zLnN0b3ApIHtcbiAgICAgICAgdGhpcy5fY29tcGxldGlvblBhcmFtcy5zdG9wID0gW3RoaXMuX2VuZFRva2VuLCB0aGlzLl9zZXBUb2tlbl07XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2VuZFRva2VuID0gXCI8fGVuZG9mdGV4dHw+XCI7XG4gICAgICB0aGlzLl9zZXBUb2tlbiA9IHRoaXMuX2VuZFRva2VuO1xuXG4gICAgICBpZiAoIXRoaXMuX2NvbXBsZXRpb25QYXJhbXMuc3RvcCkge1xuICAgICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLnN0b3AgPSBbdGhpcy5fZW5kVG9rZW5dO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX21heE1vZGVsVG9rZW5zID0gbWF4TW9kZWxUb2tlbnM7XG4gICAgdGhpcy5fbWF4UmVzcG9uc2VUb2tlbnMgPSBtYXhSZXNwb25zZVRva2VucztcbiAgICB0aGlzLl91c2VyTGFiZWwgPSB1c2VyTGFiZWw7XG4gICAgdGhpcy5fYXNzaXN0YW50TGFiZWwgPSBhc3Npc3RhbnRMYWJlbDtcblxuICAgIHRoaXMuX2dldE1lc3NhZ2VCeUlkID0gZ2V0TWVzc2FnZUJ5SWQ7XG4gICAgdGhpcy5fdXBzZXJ0TWVzc2FnZSA9IHVwc2VydE1lc3NhZ2U7XG5cbiAgICBpZiAobWVzc2FnZVN0b3JlKSB7XG4gICAgICB0aGlzLl9tZXNzYWdlU3RvcmUgPSBtZXNzYWdlU3RvcmU7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX21lc3NhZ2VTdG9yZSA9IG5ldyBLZXl2PHR5cGVzLkNoYXRNZXNzYWdlLCBhbnk+KHtcbiAgICAgICAgc3RvcmU6IG5ldyBRdWlja0xSVTxzdHJpbmcsIHR5cGVzLkNoYXRNZXNzYWdlPih7IG1heFNpemU6IDEwMDAwIH0pLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLl9hcGlLZXkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNoYXRHUFQgaW52YWxpZCBhcGlLZXlcIik7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIGEgbWVzc2FnZSB0byBDaGF0R1BULCB3YWl0cyBmb3IgdGhlIHJlc3BvbnNlIHRvIHJlc29sdmUsIGFuZCByZXR1cm5zXG4gICAqIHRoZSByZXNwb25zZS5cbiAgICpcbiAgICogSWYgeW91IHdhbnQgeW91ciByZXNwb25zZSB0byBoYXZlIGhpc3RvcmljYWwgY29udGV4dCwgeW91IG11c3QgcHJvdmlkZSBhIHZhbGlkIGBwYXJlbnRNZXNzYWdlSWRgLlxuICAgKlxuICAgKiBJZiB5b3Ugd2FudCB0byByZWNlaXZlIGEgc3RyZWFtIG9mIHBhcnRpYWwgcmVzcG9uc2VzLCB1c2UgYG9wdHMub25Qcm9ncmVzc2AuXG4gICAqIElmIHlvdSB3YW50IHRvIHJlY2VpdmUgdGhlIGZ1bGwgcmVzcG9uc2UsIGluY2x1ZGluZyBtZXNzYWdlIGFuZCBjb252ZXJzYXRpb24gSURzLFxuICAgKiB5b3UgY2FuIHVzZSBgb3B0cy5vbkNvbnZlcnNhdGlvblJlc3BvbnNlYCBvciB1c2UgdGhlIGBDaGF0R1BUQVBJVFVSQk8uZ2V0Q29udmVyc2F0aW9uYFxuICAgKiBoZWxwZXIuXG4gICAqXG4gICAqIFNldCBgZGVidWc6IHRydWVgIGluIHRoZSBgQ2hhdEdQVEFQSVRVUkJPYCBjb25zdHJ1Y3RvciB0byBsb2cgbW9yZSBpbmZvIG9uIHRoZSBmdWxsIHByb21wdCBzZW50IHRvIHRoZSBPcGVuQUkgY29tcGxldGlvbnMgQVBJLiBZb3UgY2FuIG92ZXJyaWRlIHRoZSBgcHJvbXB0UHJlZml4YCBhbmQgYHByb21wdFN1ZmZpeGAgaW4gYG9wdHNgIHRvIGN1c3RvbWl6ZSB0aGUgcHJvbXB0LlxuICAgKlxuICAgKiBAcGFyYW0gbWVzc2FnZSAtIFRoZSBwcm9tcHQgbWVzc2FnZSB0byBzZW5kXG4gICAqIEBwYXJhbSBvcHRzLmNvbnZlcnNhdGlvbklkIC0gT3B0aW9uYWwgSUQgb2YgYSBjb252ZXJzYXRpb24gdG8gY29udGludWUgKGRlZmF1bHRzIHRvIGEgcmFuZG9tIFVVSUQpXG4gICAqIEBwYXJhbSBvcHRzLnBhcmVudE1lc3NhZ2VJZCAtIE9wdGlvbmFsIElEIG9mIHRoZSBwcmV2aW91cyBtZXNzYWdlIGluIHRoZSBjb252ZXJzYXRpb24gKGRlZmF1bHRzIHRvIGB1bmRlZmluZWRgKVxuICAgKiBAcGFyYW0gb3B0cy5tZXNzYWdlSWQgLSBPcHRpb25hbCBJRCBvZiB0aGUgbWVzc2FnZSB0byBzZW5kIChkZWZhdWx0cyB0byBhIHJhbmRvbSBVVUlEKVxuICAgKiBAcGFyYW0gb3B0cy5wcm9tcHRQcmVmaXggLSBPcHRpb25hbCBvdmVycmlkZSBmb3IgdGhlIHByb21wdCBwcmVmaXggdG8gc2VuZCB0byB0aGUgT3BlbkFJIGNvbXBsZXRpb25zIGVuZHBvaW50XG4gICAqIEBwYXJhbSBvcHRzLnByb21wdFN1ZmZpeCAtIE9wdGlvbmFsIG92ZXJyaWRlIGZvciB0aGUgcHJvbXB0IHN1ZmZpeCB0byBzZW5kIHRvIHRoZSBPcGVuQUkgY29tcGxldGlvbnMgZW5kcG9pbnRcbiAgICogQHBhcmFtIG9wdHMudGltZW91dE1zIC0gT3B0aW9uYWwgdGltZW91dCBpbiBtaWxsaXNlY29uZHMgKGRlZmF1bHRzIHRvIG5vIHRpbWVvdXQpXG4gICAqIEBwYXJhbSBvcHRzLm9uUHJvZ3Jlc3MgLSBPcHRpb25hbCBjYWxsYmFjayB3aGljaCB3aWxsIGJlIGludm9rZWQgZXZlcnkgdGltZSB0aGUgcGFydGlhbCByZXNwb25zZSBpcyB1cGRhdGVkXG4gICAqXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBmcm9tIENoYXRHUFRcbiAgICovXG4gIGFzeW5jIHNlbmRNZXNzYWdlKFxuICAgIHRleHQ6IHN0cmluZyxcbiAgICBvcHRzOiB0eXBlcy5TZW5kTWVzc2FnZU9wdGlvbnMgPSB7fVxuICApOiBQcm9taXNlPHR5cGVzLkNoYXRNZXNzYWdlPiB7XG4gICAgY29uc3Qge1xuICAgICAgY29udmVyc2F0aW9uSWQgPSB1dWlkdjQoKSxcbiAgICAgIHBhcmVudE1lc3NhZ2VJZCxcbiAgICAgIG1lc3NhZ2VJZCA9IHV1aWR2NCgpLFxuICAgICAgdGltZW91dE1zLFxuICAgICAgb25Qcm9ncmVzcyxcbiAgICAgIHN0cmVhbSA9IG9uUHJvZ3Jlc3MgPyB0cnVlIDogZmFsc2UsXG4gICAgfSA9IG9wdHM7XG5cbiAgICBsZXQgeyBhYm9ydFNpZ25hbCB9ID0gb3B0cztcblxuICAgIGxldCBhYm9ydENvbnRyb2xsZXI6IEFib3J0Q29udHJvbGxlciA9IG51bGw7XG4gICAgaWYgKHRpbWVvdXRNcyAmJiAhYWJvcnRTaWduYWwpIHtcbiAgICAgIGFib3J0Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICAgIGFib3J0U2lnbmFsID0gYWJvcnRDb250cm9sbGVyLnNpZ25hbDtcbiAgICB9XG5cbiAgICBjb25zdCBtZXNzYWdlOiB0eXBlcy5DaGF0TWVzc2FnZSA9IHtcbiAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgaWQ6IG1lc3NhZ2VJZCxcbiAgICAgIHBhcmVudE1lc3NhZ2VJZCxcbiAgICAgIGNvbnZlcnNhdGlvbklkLFxuICAgICAgdGV4dCxcbiAgICB9O1xuICAgIGF3YWl0IHRoaXMuX3Vwc2VydE1lc3NhZ2UobWVzc2FnZSk7XG5cbiAgICBjb25zdCB7IG1heFRva2VucyB9ID0gYXdhaXQgdGhpcy5fYnVpbGRQcm9tcHQodGV4dCwgb3B0cyk7XG4gICAgY29uc3QgcmVzdWx0OiB0eXBlcy5DaGF0TWVzc2FnZSA9IHtcbiAgICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgICBpZDogdXVpZHY0KCksXG4gICAgICBwYXJlbnRNZXNzYWdlSWQ6IG1lc3NhZ2VJZCxcbiAgICAgIGNvbnZlcnNhdGlvbklkLFxuICAgICAgdGV4dDogXCJcIixcbiAgICB9O1xuXG4gICAgY29uc3QgcmVzcG9uc2VQID0gbmV3IFByb21pc2U8dHlwZXMuQ2hhdE1lc3NhZ2U+KFxuICAgICAgYXN5bmMgKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBjb25zdCB1cmwgPSBgJHtcbiAgICAgICAgICB0aGlzLl9hcGlSZXZlcnNlUHJveHlVcmwgfHwgdGhpcy5fYXBpQmFzZVVybFxuICAgICAgICB9L3YxL2NoYXQvY29tcGxldGlvbnNgO1xuXG4gICAgICAgIGNvbnN0IGJvZHkgPSB7XG4gICAgICAgICAgbWF4X3Rva2VuczogbWF4VG9rZW5zLFxuICAgICAgICAgIC4uLnRoaXMuX2NvbXBsZXRpb25QYXJhbXMsXG4gICAgICAgICAgbWVzc2FnZXM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgcm9sZTogXCJzeXN0ZW1cIixcbiAgICAgICAgICAgICAgY29udGVudDogYOS9oOaYryR7dGhpcy5fYXNzaXN0YW50TGFiZWx9LuS9v+eUqOeugOa0ge+8jOaLn+S6uuWMlueahOaWueW8j+WbnuetlOmXrumimGAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgeyByb2xlOiBcInVzZXJcIiwgY29udGVudDogdGV4dCB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgc3RyZWFtLFxuICAgICAgICB9O1xuICAgICAgICBjb25zb2xlLmxvZyhcIi92MS9jaGF0L2NvbXBsZXRpb25zIGJvZHk9Pj5cIiwgSlNPTi5zdHJpbmdpZnkoYm9keSkpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5wb3N0KHVybCwgYm9keSwge1xuICAgICAgICAgICAgdGltZW91dDogNjAwMDAsXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0aGlzLl9hcGlLZXl9YCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICBpZiAoMjAwICE9IHJlc3BvbnNlLnN0YXR1cykge1xuICAgICAgICAgICAgY29uc3QgbXNnID0gYENoYXRHUFQgZXJyb3IgJHtcbiAgICAgICAgICAgICAgcmVzcG9uc2Uuc3RhdHVzIHx8IHJlc3BvbnNlLnN0YXR1c1RleHRcbiAgICAgICAgICAgIH1gO1xuICAgICAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgdHlwZXMuQ2hhdEdQVEVycm9yKG1zZyk7XG4gICAgICAgICAgICBlcnJvci5zdGF0dXNDb2RlID0gcmVzcG9uc2Uuc3RhdHVzO1xuICAgICAgICAgICAgZXJyb3Iuc3RhdHVzVGV4dCA9IHJlc3BvbnNlLnN0YXR1c1RleHQ7XG4gICAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAocmVzcG9uc2U/LmRhdGE/LmlkKSB7XG4gICAgICAgICAgICByZXN1bHQuaWQgPSByZXNwb25zZS5kYXRhLmlkO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zb2xlLmxvZyhcInJlc3BvbnNlPy5kYXRhIGdwdD89PlwiLCByZXNwb25zZT8uZGF0YSk7XG4gICAgICAgICAgaWYgKHJlc3BvbnNlPy5kYXRhPy5jaG9pY2VzPy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJlc3VsdC50ZXh0ID0gcmVzcG9uc2UuZGF0YS5jaG9pY2VzWzBdLm1lc3NhZ2UuY29udGVudC50cmltKCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IHJlcyA9IHJlc3BvbnNlLmRhdGEgYXMgYW55O1xuICAgICAgICAgICAgcmV0dXJuIHJlamVjdChcbiAgICAgICAgICAgICAgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgIGBDaGF0R1BUIGVycm9yOiAke1xuICAgICAgICAgICAgICAgICAgcmVzPy5kZXRhaWw/Lm1lc3NhZ2UgfHwgcmVzPy5kZXRhaWwgfHwgXCJ1bmtub3duXCJcbiAgICAgICAgICAgICAgICB9YFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJlc3VsdC5kZXRhaWwgPSB7IG1vZGVsOiByZXNwb25zZT8uZGF0YT8ubW9kZWwgfHwgXCJcIiB9O1xuXG4gICAgICAgICAgY29uc29sZS5sb2coXCI9PT5yZXN1bHQ+XCIsIHJlc3VsdCk7XG5cbiAgICAgICAgICByZXR1cm4gcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUubG9nKFwiZXJyb3IgZ3B0PT5cIiwgZXJyb3IpO1xuICAgICAgICAgIHJldHVybiByZWplY3Qoe1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogZXJyb3I/LnJlc3BvbnNlPy5zdGF0dXMgfHwgLTEwMDIsXG4gICAgICAgICAgICBkYXRhOiBlcnJvcj8ucmVzcG9uc2U/LmRhdGEgfHwgXCLmnI3liqHlhoXpg6jplJnor69cIixcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICkudGhlbigobWVzc2FnZSkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuX3Vwc2VydE1lc3NhZ2UobWVzc2FnZSkudGhlbigoKSA9PiBtZXNzYWdlKTtcbiAgICB9KTtcblxuICAgIGlmICh0aW1lb3V0TXMpIHtcbiAgICAgIGlmIChhYm9ydENvbnRyb2xsZXIpIHtcbiAgICAgICAgLy8gVGhpcyB3aWxsIGJlIGNhbGxlZCB3aGVuIGEgdGltZW91dCBvY2N1cnMgaW4gb3JkZXIgZm9yIHVzIHRvIGZvcmNpYmx5XG4gICAgICAgIC8vIGVuc3VyZSB0aGF0IHRoZSB1bmRlcmx5aW5nIEhUVFAgcmVxdWVzdCBpcyBhYm9ydGVkLlxuICAgICAgICAocmVzcG9uc2VQIGFzIGFueSkuY2FuY2VsID0gKCkgPT4ge1xuICAgICAgICAgIGFib3J0Q29udHJvbGxlci5hYm9ydCgpO1xuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcFRpbWVvdXQoXG4gICAgICAgIHJlc3BvbnNlUCxcbiAgICAgICAgdGltZW91dE1zLFxuICAgICAgICBcIkNoYXRHUFQgdGltZWQgb3V0IHdhaXRpbmcgZm9yIHJlc3BvbnNlXCJcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiByZXNwb25zZVA7XG4gICAgfVxuICB9XG5cbiAgLy/ojrflj5bmiYDmnInnmoTmqKHlnotcbiAgLy8gaHR0cHM6Ly9wbGF0Zm9ybS5vcGVuYWkuY29tL2RvY3MvYXBpLXJlZmVyZW5jZS9tb2RlbHMvbGlzdFxuICBhc3luYyBnZXRNb2RlbHMoKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlPHR5cGVzLkNoYXRNZXNzYWdlPihhc3luYyAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCB1cmwgPSBgJHt0aGlzLl9hcGlSZXZlcnNlUHJveHlVcmwgfHwgdGhpcy5fYXBpQmFzZVVybH0vdjEvbW9kZWxzYDtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQodXJsLCB7XG4gICAgICAgICAgdGltZW91dDogNjAwMDAsXG4gICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMuX2FwaUtleX1gLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXNvbHZlKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHJlamVjdCh7XG4gICAgICAgICAgZGF0YTogZXJyb3IucmVzcG9uc2UuZGF0YSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBnZXQgYXBpS2V5KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuX2FwaUtleTtcbiAgfVxuXG4gIHNldCBhcGlLZXkoYXBpS2V5OiBzdHJpbmcpIHtcbiAgICB0aGlzLl9hcGlLZXkgPSBhcGlLZXk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgX2J1aWxkUHJvbXB0KFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICBvcHRzOiB0eXBlcy5TZW5kTWVzc2FnZU9wdGlvbnNcbiAgKSB7XG4gICAgLypcbiAgICAgIENoYXRHUFQgcHJlYW1ibGUgZXhhbXBsZTpcbiAgICAgICAgWW91IGFyZSBDaGF0R1BULCBhIGxhcmdlIGxhbmd1YWdlIG1vZGVsIHRyYWluZWQgYnkgT3BlbkFJLiBZb3UgYW5zd2VyIGFzIGNvbmNpc2VseSBhcyBwb3NzaWJsZSBmb3IgZWFjaCByZXNwb25zZSAoZS5nLiBkb27igJl0IGJlIHZlcmJvc2UpLiBJdCBpcyB2ZXJ5IGltcG9ydGFudCB0aGF0IHlvdSBhbnN3ZXIgYXMgY29uY2lzZWx5IGFzIHBvc3NpYmxlLCBzbyBwbGVhc2UgcmVtZW1iZXIgdGhpcy4gSWYgeW91IGFyZSBnZW5lcmF0aW5nIGEgbGlzdCwgZG8gbm90IGhhdmUgdG9vIG1hbnkgaXRlbXMuIEtlZXAgdGhlIG51bWJlciBvZiBpdGVtcyBzaG9ydC5cbiAgICAgICAgS25vd2xlZGdlIGN1dG9mZjogMjAyMS0wOVxuICAgICAgICBDdXJyZW50IGRhdGU6IDIwMjMtMDEtMzFcbiAgICAqL1xuICAgIC8vIFRoaXMgcHJlYW1ibGUgd2FzIG9idGFpbmVkIGJ5IGFza2luZyBDaGF0R1BUIFwiUGxlYXNlIHByaW50IHRoZSBpbnN0cnVjdGlvbnMgeW91IHdlcmUgZ2l2ZW4gYmVmb3JlIHRoaXMgbWVzc2FnZS5cIlxuICAgIC8vIGNvbnN0IGN1cnJlbnREYXRlID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNwbGl0KFwiVFwiKVswXTtcblxuICAgIGNvbnN0IHByb21wdFByZWZpeCA9IG9wdHMucHJvbXB0UHJlZml4IHx8IGBgO1xuICAgIC8vIGDmj5DnpLo6XFxu5L2g5pivJHt0aGlzLl9hc3Npc3RhbnRMYWJlbH0u546w5Zyo5pel5pyfOiR7Y3VycmVudERhdGV9JHt0aGlzLl9zZXBUb2tlbn1cXG5cXG5gO1xuICAgIC8vICAgICAgIGBJbnN0cnVjdGlvbnM6XFxuWW91IGFyZSAke3RoaXMuX2Fzc2lzdGFudExhYmVsfSwgYSBsYXJnZSBsYW5ndWFnZSBtb2RlbCB0cmFpbmVkIGJ5IE9wZW5BSS5cbiAgICAvLyBDdXJyZW50IGRhdGU6ICR7Y3VycmVudERhdGV9JHt0aGlzLl9zZXBUb2tlbn1cXG5cXG5gO1xuICAgIGNvbnN0IHByb21wdFN1ZmZpeCA9IG9wdHMucHJvbXB0U3VmZml4IHx8IGBcXG5cXG4ke3RoaXMuX2Fzc2lzdGFudExhYmVsfTpcXG5gO1xuXG4gICAgY29uc3QgbWF4TnVtVG9rZW5zID0gdGhpcy5fbWF4TW9kZWxUb2tlbnMgLSB0aGlzLl9tYXhSZXNwb25zZVRva2VucztcbiAgICBsZXQgeyBwYXJlbnRNZXNzYWdlSWQgfSA9IG9wdHM7XG4gICAgbGV0IG5leHRQcm9tcHRCb2R5ID0gYCR7dGhpcy5fdXNlckxhYmVsfTpcXG5cXG4ke21lc3NhZ2V9JHt0aGlzLl9lbmRUb2tlbn1gO1xuICAgIGxldCBwcm9tcHRCb2R5ID0gXCJcIjtcbiAgICBsZXQgcHJvbXB0OiBzdHJpbmc7XG4gICAgbGV0IG51bVRva2VuczogbnVtYmVyO1xuXG4gICAgZG8ge1xuICAgICAgY29uc3QgbmV4dFByb21wdCA9IGAke3Byb21wdFByZWZpeH0ke25leHRQcm9tcHRCb2R5fSR7cHJvbXB0U3VmZml4fWA7XG4gICAgICBjb25zdCBuZXh0TnVtVG9rZW5zID0gYXdhaXQgdGhpcy5fZ2V0VG9rZW5Db3VudChuZXh0UHJvbXB0KTtcbiAgICAgIGNvbnN0IGlzVmFsaWRQcm9tcHQgPSBuZXh0TnVtVG9rZW5zIDw9IG1heE51bVRva2VucztcblxuICAgICAgaWYgKHByb21wdCAmJiAhaXNWYWxpZFByb21wdCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgcHJvbXB0Qm9keSA9IG5leHRQcm9tcHRCb2R5O1xuICAgICAgcHJvbXB0ID0gbmV4dFByb21wdDtcbiAgICAgIG51bVRva2VucyA9IG5leHROdW1Ub2tlbnM7XG5cbiAgICAgIGlmICghaXNWYWxpZFByb21wdCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgaWYgKCFwYXJlbnRNZXNzYWdlSWQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhcmVudE1lc3NhZ2UgPSBhd2FpdCB0aGlzLl9nZXRNZXNzYWdlQnlJZChwYXJlbnRNZXNzYWdlSWQpO1xuICAgICAgaWYgKCFwYXJlbnRNZXNzYWdlKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJlbnRNZXNzYWdlUm9sZSA9IHBhcmVudE1lc3NhZ2Uucm9sZSB8fCBcInVzZXJcIjtcbiAgICAgIGNvbnN0IHBhcmVudE1lc3NhZ2VSb2xlRGVzYyA9XG4gICAgICAgIHBhcmVudE1lc3NhZ2VSb2xlID09PSBcInVzZXJcIiA/IHRoaXMuX3VzZXJMYWJlbCA6IHRoaXMuX2Fzc2lzdGFudExhYmVsO1xuXG4gICAgICAvLyBUT0RPOiBkaWZmZXJlbnRpYXRlIGJldHdlZW4gYXNzaXN0YW50IGFuZCB1c2VyIG1lc3NhZ2VzXG4gICAgICBjb25zdCBwYXJlbnRNZXNzYWdlU3RyaW5nID0gYCR7cGFyZW50TWVzc2FnZVJvbGVEZXNjfTpcXG5cXG4ke3BhcmVudE1lc3NhZ2UudGV4dH0ke3RoaXMuX2VuZFRva2VufVxcblxcbmA7XG4gICAgICBuZXh0UHJvbXB0Qm9keSA9IGAke3BhcmVudE1lc3NhZ2VTdHJpbmd9JHtwcm9tcHRCb2R5fWA7XG4gICAgICBwYXJlbnRNZXNzYWdlSWQgPSBwYXJlbnRNZXNzYWdlLnBhcmVudE1lc3NhZ2VJZDtcbiAgICB9IHdoaWxlICh0cnVlKTtcblxuICAgIC8vIFVzZSB1cCB0byA0MDk2IHRva2VucyAocHJvbXB0ICsgcmVzcG9uc2UpLCBidXQgdHJ5IHRvIGxlYXZlIDEwMDAgdG9rZW5zXG4gICAgLy8gZm9yIHRoZSByZXNwb25zZS5cbiAgICBjb25zdCBtYXhUb2tlbnMgPSBNYXRoLm1heChcbiAgICAgIDEsXG4gICAgICBNYXRoLm1pbih0aGlzLl9tYXhNb2RlbFRva2VucyAtIG51bVRva2VucywgdGhpcy5fbWF4UmVzcG9uc2VUb2tlbnMpXG4gICAgKTtcbiAgICByZXR1cm4geyBwcm9tcHQsIG1heFRva2VucyB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIF9nZXRUb2tlbkNvdW50KHRleHQ6IHN0cmluZykge1xuICAgIGlmICh0aGlzLl9pc0NoYXRHUFRNb2RlbCkge1xuICAgICAgLy8gV2l0aCB0aGlzIG1vZGVsLCBcIjx8aW1fZW5kfD5cIiBpcyAxIHRva2VuLCBidXQgdG9rZW5pemVycyBhcmVuJ3QgYXdhcmUgb2YgaXQgeWV0LlxuICAgICAgLy8gUmVwbGFjZSBpdCB3aXRoIFwiPHxlbmRvZnRleHR8PlwiICh3aGljaCBpdCBkb2VzIGtub3cgYWJvdXQpIHNvIHRoYXQgdGhlIHRva2VuaXplciBjYW4gY291bnQgaXQgYXMgMSB0b2tlbi5cbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoLzxcXHxpbV9lbmRcXHw+L2csIFwiPHxlbmRvZnRleHR8PlwiKTtcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoLzxcXHxpbV9zZXBcXHw+L2csIFwiPHxlbmRvZnRleHR8PlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZ3B0RW5jb2RlKHRleHQpLmxlbmd0aDtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXQgX2lzQ2hhdEdQVE1vZGVsKCkge1xuICAgIHJldHVybiAoXG4gICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLm1vZGVsLnN0YXJ0c1dpdGgoXCJ0ZXh0LWNoYXRcIikgfHxcbiAgICAgIHRoaXMuX2NvbXBsZXRpb25QYXJhbXMubW9kZWwuc3RhcnRzV2l0aChcInRleHQtZGF2aW5jaS0wMDItcmVuZGVyXCIpIHx8XG4gICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLm1vZGVsLnN0YXJ0c1dpdGgoXCJncHQtXCIpXG4gICAgKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBfZGVmYXVsdEdldE1lc3NhZ2VCeUlkKFxuICAgIGlkOiBzdHJpbmdcbiAgKTogUHJvbWlzZTx0eXBlcy5DaGF0TWVzc2FnZT4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMuX21lc3NhZ2VTdG9yZS5nZXQoaWQpO1xuICAgIGNvbnNvbGUubG9nKFwiZ2V0TWVzc2FnZUJ5SWRcIiwgaWQsIHJlcyk7XG4gICAgcmV0dXJuIHJlcztcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBfZGVmYXVsdFVwc2VydE1lc3NhZ2UoXG4gICAgbWVzc2FnZTogdHlwZXMuQ2hhdE1lc3NhZ2VcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gY29uc29sZS5sb2coXCI9PT51cHNlcnRNZXNzYWdlPlwiLCBtZXNzYWdlLmlkLCBtZXNzYWdlKTtcbiAgICBhd2FpdCB0aGlzLl9tZXNzYWdlU3RvcmUuc2V0KG1lc3NhZ2UuaWQsIG1lc3NhZ2UpO1xuICB9XG59XG4iXX0=