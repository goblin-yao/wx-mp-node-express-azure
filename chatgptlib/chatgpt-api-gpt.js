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
            const url = this._apiReverseProxyUrl || `${this._apiBaseUrl}/v1/chat/completions`;
            const body = Object.assign(Object.assign({ max_tokens: maxTokens }, this._completionParams), { messages: [{ role: "user", content: text }], stream });
            console.log("/v1/chat/completions body=>>", JSON.stringify(body));
            try {
                const response = await axios_1.default.post(url, body, {
                    timeout: 300000,
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
            const url = this._apiReverseProxyUrl || `${this._apiBaseUrl}/v1/models`;
            try {
                const response = await axios_1.default.get(url, {
                    timeout: 30000,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2hhdGdwdC1hcGktZ3B0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vY2hhdGdwdGxpYl9zcmMvY2hhdGdwdC1hcGktZ3B0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW9EO0FBQ3BELGdEQUF3QjtBQUN4QiwwREFBaUM7QUFDakMsK0JBQW9DO0FBRXBDLCtDQUFpQztBQUNqQyxrREFBMEI7QUFFMUIsMERBQWlDO0FBRWpDLHFDQUlrQjtBQUVsQixNQUFhLGVBQWU7SUFrQzFCLFlBQVksSUE2Qlg7UUFDQyxNQUFNLEVBQ0osTUFBTSxFQUNOLFVBQVUsR0FBRyx3QkFBd0IsRUFDckMsa0JBQWtCLEVBQ2xCLEtBQUssR0FBRyxLQUFLLEVBQ2IsWUFBWSxFQUNaLGdCQUFnQixFQUNoQixjQUFjLEdBQUcsSUFBSSxFQUNyQixpQkFBaUIsR0FBRyxJQUFJLEVBQ3hCLFNBQVMsR0FBRywyQkFBa0IsRUFDOUIsY0FBYyxHQUFHLGdDQUF1QixFQUN4QyxjQUFjLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixFQUM1QyxhQUFhLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixHQUMzQyxHQUFHLElBQUksQ0FBQztRQUVULElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDO1FBQ3RCLElBQUksQ0FBQyxXQUFXLEdBQUcsVUFBVSxDQUFDO1FBQzlCLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxrQkFBa0IsQ0FBQztRQUM5QyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUM7UUFFdEIsSUFBSSxDQUFDLGlCQUFpQixtQkFDcEIsS0FBSyxFQUFFLDBCQUFpQixFQUN4QixXQUFXLEVBQUUsR0FBRyxFQUNoQixLQUFLLEVBQUUsR0FBRyxFQUNWLGdCQUFnQixFQUFFLEdBQUcsSUFDbEIsZ0JBQWdCLENBQ3BCLENBQUM7UUFFRixJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUU7WUFDeEIs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QUFPLENBQUMsZUFBZSxFQUFFLGVBQWUsQ0FBQyxDQUFDO1lBQ3RELElBQUksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLGVBQWUsRUFBRSxlQUFlLENBQUMsQ0FBQztTQUN2RDtRQUVELE9BQU8sSUFBQSxzQkFBUyxFQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQztJQUNoQyxDQUFDO0lBRUQsSUFBYyxlQUFlO1FBQzNCLE9BQU8sQ0FDTCxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxXQUFXLENBQUM7WUFDcEQsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMseUJBQXlCLENBQUM7WUFDbEUsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQ2hELENBQUM7SUFDSixDQUFDO0lBRVMsS0FBSyxDQUFDLHNCQUFzQixDQUNwQyxFQUFVO1FBRVYsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUM3QyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixFQUFFLEVBQUUsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUN2QyxPQUFPLEdBQUcsQ0FBQztJQUNiLENBQUM7SUFFUyxLQUFLLENBQUMscUJBQXFCLENBQ25DLE9BQTBCO1FBRzFCLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUUsRUFBRSxPQUFPLENBQUMsQ0FBQztJQUNwRCxDQUFDO0NBQ0Y7QUEzWkQsMENBMlpDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZW5jb2RlIGFzIGdwdEVuY29kZSB9IGZyb20gXCJncHQtMy1lbmNvZGVyXCI7XG5pbXBvcnQgS2V5diBmcm9tIFwia2V5dlwiO1xuaW1wb3J0IHBUaW1lb3V0IGZyb20gXCJwLXRpbWVvdXRcIjtcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gXCJ1dWlkXCI7XG5cbmltcG9ydCAqIGFzIHR5cGVzIGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgYXhpb3MgZnJvbSBcImF4aW9zXCI7XG5cbmltcG9ydCBRdWlja0xSVSBmcm9tIFwicXVpY2stbHJ1XCI7XG5cbmltcG9ydCB7XG4gIENIQVRHUFRfTU9ERUxfR1BULFxuICBVU0VSX0xBQkVMX0RFRkFVTFQsXG4gIEFTU0lTVEFOVF9MQUJFTF9ERUZBVUxULFxufSBmcm9tIFwiLi9jb25maWdcIjtcblxuZXhwb3J0IGNsYXNzIENoYXRHUFRBUElUVVJCTyB7XG4gIHByb3RlY3RlZCBfYXBpS2V5OiBzdHJpbmc7XG4gIHByb3RlY3RlZCBfYXBpQmFzZVVybDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2FwaVJldmVyc2VQcm94eVVybDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2RlYnVnOiBib29sZWFuO1xuXG4gIHByb3RlY3RlZCBfY29tcGxldGlvblBhcmFtczogT21pdDx0eXBlcy5vcGVuYWkuQ29tcGxldGlvblBhcmFtcywgXCJwcm9tcHRcIj47XG4gIHByb3RlY3RlZCBfbWF4TW9kZWxUb2tlbnM6IG51bWJlcjtcbiAgcHJvdGVjdGVkIF9tYXhSZXNwb25zZVRva2VuczogbnVtYmVyO1xuICBwcm90ZWN0ZWQgX3VzZXJMYWJlbDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2Fzc2lzdGFudExhYmVsOiBzdHJpbmc7XG4gIHByb3RlY3RlZCBfZW5kVG9rZW46IHN0cmluZztcbiAgcHJvdGVjdGVkIF9zZXBUb2tlbjogc3RyaW5nO1xuXG4gIHByb3RlY3RlZCBfZ2V0TWVzc2FnZUJ5SWQ6IHR5cGVzLkdldE1lc3NhZ2VCeUlkRnVuY3Rpb247XG4gIHByb3RlY3RlZCBfdXBzZXJ0TWVzc2FnZTogdHlwZXMuVXBzZXJ0TWVzc2FnZUZ1bmN0aW9uO1xuXG4gIHByb3RlY3RlZCBfbWVzc2FnZVN0b3JlOiBLZXl2PHR5cGVzLkNoYXRNZXNzYWdlPjtcblxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBjbGllbnQgd3JhcHBlciBhcm91bmQgT3BlbkFJJ3MgY29tcGxldGlvbiBBUEkgdXNpbmcgdGhlXG4gICAqIHVub2ZmaWNpYWwgQ2hhdEdQVCBtb2RlbC5cbiAgICpcbiAgICogQHBhcmFtIGFwaUtleSAtIE9wZW5BSSBBUEkga2V5IChyZXF1aXJlZCkuXG4gICAqIEBwYXJhbSBhcGlCYXNlVXJsIC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHRoZSBPcGVuQUkgQVBJIGJhc2UgVVJMLlxuICAgKiBAcGFyYW0gYXBpUmV2ZXJzZVByb3h5VXJsIC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIGEgcmV2ZXJzZSBwcm94eSBVUkwgdG8gdXNlIGluc3RlYWQgb2YgdGhlIE9wZW5BSSBBUEkgY29tcGxldGlvbnMgQVBJLlxuICAgKiBAcGFyYW0gZGVidWcgLSBPcHRpb25hbCBlbmFibGVzIGxvZ2dpbmcgZGVidWdnaW5nIGluZm8gdG8gc3Rkb3V0LlxuICAgKiBAcGFyYW0gY29tcGxldGlvblBhcmFtcyAtIFBhcmFtIG92ZXJyaWRlcyB0byBzZW5kIHRvIHRoZSBbT3BlbkFJIGNvbXBsZXRpb24gQVBJXShodHRwczovL3BsYXRmb3JtLm9wZW5haS5jb20vZG9jcy9hcGktcmVmZXJlbmNlL2NvbXBsZXRpb25zL2NyZWF0ZSkuIE9wdGlvbnMgbGlrZSBgdGVtcGVyYXR1cmVgIGFuZCBgcHJlc2VuY2VfcGVuYWx0eWAgY2FuIGJlIHR3ZWFrZWQgdG8gY2hhbmdlIHRoZSBwZXJzb25hbGl0eSBvZiB0aGUgYXNzaXN0YW50LlxuICAgKiBAcGFyYW0gbWF4TW9kZWxUb2tlbnMgLSBPcHRpb25hbCBvdmVycmlkZSBmb3IgdGhlIG1heGltdW0gbnVtYmVyIG9mIHRva2VucyBhbGxvd2VkIGJ5IHRoZSBtb2RlbCdzIGNvbnRleHQuIERlZmF1bHRzIHRvIDQwOTYgZm9yIHRoZSBgdGV4dC1jaGF0LWRhdmluY2ktMDAyLTIwMjMwMTI2YCBtb2RlbC5cbiAgICogQHBhcmFtIG1heFJlc3BvbnNlVG9rZW5zIC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHRoZSBtaW5pbXVtIG51bWJlciBvZiB0b2tlbnMgYWxsb3dlZCBmb3IgdGhlIG1vZGVsJ3MgcmVzcG9uc2UuIERlZmF1bHRzIHRvIDEwMDAgZm9yIHRoZSBgdGV4dC1jaGF0LWRhdmluY2ktMDAyLTIwMjMwMTI2YCBtb2RlbC5cbiAgICogQHBhcmFtIG1lc3NhZ2VTdG9yZSAtIE9wdGlvbmFsIFtLZXl2XShodHRwczovL2dpdGh1Yi5jb20vamFyZWR3cmF5L2tleXYpIHN0b3JlIHRvIHBlcnNpc3QgY2hhdCBtZXNzYWdlcyB0by4gSWYgbm90IHByb3ZpZGVkLCBtZXNzYWdlcyB3aWxsIGJlIGxvc3Qgd2hlbiB0aGUgcHJvY2VzcyBleGl0cy5cbiAgICogQHBhcmFtIGdldE1lc3NhZ2VCeUlkIC0gT3B0aW9uYWwgZnVuY3Rpb24gdG8gcmV0cmlldmUgYSBtZXNzYWdlIGJ5IGl0cyBJRC4gSWYgbm90IHByb3ZpZGVkLCB0aGUgZGVmYXVsdCBpbXBsZW1lbnRhdGlvbiB3aWxsIGJlIHVzZWQgKHVzaW5nIGFuIGluLW1lbW9yeSBgbWVzc2FnZVN0b3JlYCkuXG4gICAqIEBwYXJhbSB1cHNlcnRNZXNzYWdlIC0gT3B0aW9uYWwgZnVuY3Rpb24gdG8gaW5zZXJ0IG9yIHVwZGF0ZSBhIG1lc3NhZ2UuIElmIG5vdCBwcm92aWRlZCwgdGhlIGRlZmF1bHQgaW1wbGVtZW50YXRpb24gd2lsbCBiZSB1c2VkICh1c2luZyBhbiBpbi1tZW1vcnkgYG1lc3NhZ2VTdG9yZWApLlxuICAgKi9cbiAgY29uc3RydWN0b3Iob3B0czoge1xuICAgIGFwaUtleTogc3RyaW5nO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYCdodHRwczovL2FwaS5vcGVuYWkuY29tJ2AgKiovXG4gICAgYXBpQmFzZVVybD86IHN0cmluZztcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGB1bmRlZmluZWRgICoqL1xuICAgIGFwaVJldmVyc2VQcm94eVVybD86IHN0cmluZztcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGBmYWxzZWAgKiovXG4gICAgZGVidWc/OiBib29sZWFuO1xuXG4gICAgY29tcGxldGlvblBhcmFtcz86IFBhcnRpYWw8dHlwZXMub3BlbmFpLkNvbXBsZXRpb25QYXJhbXM+O1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYDQwOTZgICoqL1xuICAgIG1heE1vZGVsVG9rZW5zPzogbnVtYmVyO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYDEwMDBgICoqL1xuICAgIG1heFJlc3BvbnNlVG9rZW5zPzogbnVtYmVyO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYCdVc2VyJ2AgKiovXG4gICAgdXNlckxhYmVsPzogc3RyaW5nO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYCdDaGF0R1BUJ2AgKiovXG4gICAgYXNzaXN0YW50TGFiZWw/OiBzdHJpbmc7XG5cbiAgICBtZXNzYWdlU3RvcmU/OiBLZXl2O1xuICAgIGdldE1lc3NhZ2VCeUlkPzogdHlwZXMuR2V0TWVzc2FnZUJ5SWRGdW5jdGlvbjtcbiAgICB1cHNlcnRNZXNzYWdlPzogdHlwZXMuVXBzZXJ0TWVzc2FnZUZ1bmN0aW9uO1xuICB9KSB7XG4gICAgY29uc3Qge1xuICAgICAgYXBpS2V5LFxuICAgICAgYXBpQmFzZVVybCA9IFwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbVwiLFxuICAgICAgYXBpUmV2ZXJzZVByb3h5VXJsLFxuICAgICAgZGVidWcgPSBmYWxzZSxcbiAgICAgIG1lc3NhZ2VTdG9yZSxcbiAgICAgIGNvbXBsZXRpb25QYXJhbXMsXG4gICAgICBtYXhNb2RlbFRva2VucyA9IDQwOTYsIC8vNDA5NlxuICAgICAgbWF4UmVzcG9uc2VUb2tlbnMgPSAxNTAwLCAvLzEwMDBcbiAgICAgIHVzZXJMYWJlbCA9IFVTRVJfTEFCRUxfREVGQVVMVCxcbiAgICAgIGFzc2lzdGFudExhYmVsID0gQVNTSVNUQU5UX0xBQkVMX0RFRkFVTFQsXG4gICAgICBnZXRNZXNzYWdlQnlJZCA9IHRoaXMuX2RlZmF1bHRHZXRNZXNzYWdlQnlJZCxcbiAgICAgIHVwc2VydE1lc3NhZ2UgPSB0aGlzLl9kZWZhdWx0VXBzZXJ0TWVzc2FnZSxcbiAgICB9ID0gb3B0cztcblxuICAgIHRoaXMuX2FwaUtleSA9IGFwaUtleTtcbiAgICB0aGlzLl9hcGlCYXNlVXJsID0gYXBpQmFzZVVybDtcbiAgICB0aGlzLl9hcGlSZXZlcnNlUHJveHlVcmwgPSBhcGlSZXZlcnNlUHJveHlVcmw7XG4gICAgdGhpcy5fZGVidWcgPSAhIWRlYnVnO1xuXG4gICAgdGhpcy5fY29tcGxldGlvblBhcmFtcyA9IHtcbiAgICAgIG1vZGVsOiBDSEFUR1BUX01PREVMX0dQVCxcbiAgICAgIHRlbXBlcmF0dXJlOiAwLjQsIC8vIDAuMiDkvb/nlKjku4DkuYjph4fmoLfmuKnluqbvvIzku4vkuo4gMCDlkowgMiDkuYvpl7TjgILovoPpq5jnmoTlgLzvvIjlpoIgMC4477yJ5bCG5L2/6L6T5Ye65pu05Yqg6ZqP5py677yM6ICM6L6D5L2O55qE5YC877yI5aaCIDAuMu+8ieWwhuS9v+i+k+WHuuabtOWKoOmbhuS4reWSjOehruWumuOAglxuICAgICAgdG9wX3A6IDEuMCxcbiAgICAgIHByZXNlbmNlX3BlbmFsdHk6IDEuMCxcbiAgICAgIC4uLmNvbXBsZXRpb25QYXJhbXMsXG4gICAgfTtcblxuICAgIGlmICh0aGlzLl9pc0NoYXRHUFRNb2RlbCkge1xuICAgICAgdGhpcy5fZW5kVG9rZW4gPSBcIjx8aW1fZW5kfD5cIjtcbiAgICAgIHRoaXMuX3NlcFRva2VuID0gXCI8fGltX3NlcHw+XCI7XG5cbiAgICAgIGlmICghdGhpcy5fY29tcGxldGlvblBhcmFtcy5zdG9wKSB7XG4gICAgICAgIHRoaXMuX2NvbXBsZXRpb25QYXJhbXMuc3RvcCA9IFt0aGlzLl9lbmRUb2tlbiwgdGhpcy5fc2VwVG9rZW5dO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9lbmRUb2tlbiA9IFwiPHxlbmRvZnRleHR8PlwiO1xuICAgICAgdGhpcy5fc2VwVG9rZW4gPSB0aGlzLl9lbmRUb2tlbjtcblxuICAgICAgaWYgKCF0aGlzLl9jb21wbGV0aW9uUGFyYW1zLnN0b3ApIHtcbiAgICAgICAgdGhpcy5fY29tcGxldGlvblBhcmFtcy5zdG9wID0gW3RoaXMuX2VuZFRva2VuXTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9tYXhNb2RlbFRva2VucyA9IG1heE1vZGVsVG9rZW5zO1xuICAgIHRoaXMuX21heFJlc3BvbnNlVG9rZW5zID0gbWF4UmVzcG9uc2VUb2tlbnM7XG4gICAgdGhpcy5fdXNlckxhYmVsID0gdXNlckxhYmVsO1xuICAgIHRoaXMuX2Fzc2lzdGFudExhYmVsID0gYXNzaXN0YW50TGFiZWw7XG5cbiAgICB0aGlzLl9nZXRNZXNzYWdlQnlJZCA9IGdldE1lc3NhZ2VCeUlkO1xuICAgIHRoaXMuX3Vwc2VydE1lc3NhZ2UgPSB1cHNlcnRNZXNzYWdlO1xuXG4gICAgaWYgKG1lc3NhZ2VTdG9yZSkge1xuICAgICAgdGhpcy5fbWVzc2FnZVN0b3JlID0gbWVzc2FnZVN0b3JlO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9tZXNzYWdlU3RvcmUgPSBuZXcgS2V5djx0eXBlcy5DaGF0TWVzc2FnZSwgYW55Pih7XG4gICAgICAgIHN0b3JlOiBuZXcgUXVpY2tMUlU8c3RyaW5nLCB0eXBlcy5DaGF0TWVzc2FnZT4oeyBtYXhTaXplOiAxMDAwMCB9KSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5fYXBpS2V5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDaGF0R1BUIGludmFsaWQgYXBpS2V5XCIpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyBhIG1lc3NhZ2UgdG8gQ2hhdEdQVCwgd2FpdHMgZm9yIHRoZSByZXNwb25zZSB0byByZXNvbHZlLCBhbmQgcmV0dXJuc1xuICAgKiB0aGUgcmVzcG9uc2UuXG4gICAqXG4gICAqIElmIHlvdSB3YW50IHlvdXIgcmVzcG9uc2UgdG8gaGF2ZSBoaXN0b3JpY2FsIGNvbnRleHQsIHlvdSBtdXN0IHByb3ZpZGUgYSB2YWxpZCBgcGFyZW50TWVzc2FnZUlkYC5cbiAgICpcbiAgICogSWYgeW91IHdhbnQgdG8gcmVjZWl2ZSBhIHN0cmVhbSBvZiBwYXJ0aWFsIHJlc3BvbnNlcywgdXNlIGBvcHRzLm9uUHJvZ3Jlc3NgLlxuICAgKiBJZiB5b3Ugd2FudCB0byByZWNlaXZlIHRoZSBmdWxsIHJlc3BvbnNlLCBpbmNsdWRpbmcgbWVzc2FnZSBhbmQgY29udmVyc2F0aW9uIElEcyxcbiAgICogeW91IGNhbiB1c2UgYG9wdHMub25Db252ZXJzYXRpb25SZXNwb25zZWAgb3IgdXNlIHRoZSBgQ2hhdEdQVEFQSVRVUkJPLmdldENvbnZlcnNhdGlvbmBcbiAgICogaGVscGVyLlxuICAgKlxuICAgKiBTZXQgYGRlYnVnOiB0cnVlYCBpbiB0aGUgYENoYXRHUFRBUElUVVJCT2AgY29uc3RydWN0b3IgdG8gbG9nIG1vcmUgaW5mbyBvbiB0aGUgZnVsbCBwcm9tcHQgc2VudCB0byB0aGUgT3BlbkFJIGNvbXBsZXRpb25zIEFQSS4gWW91IGNhbiBvdmVycmlkZSB0aGUgYHByb21wdFByZWZpeGAgYW5kIGBwcm9tcHRTdWZmaXhgIGluIGBvcHRzYCB0byBjdXN0b21pemUgdGhlIHByb21wdC5cbiAgICpcbiAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgcHJvbXB0IG1lc3NhZ2UgdG8gc2VuZFxuICAgKiBAcGFyYW0gb3B0cy5jb252ZXJzYXRpb25JZCAtIE9wdGlvbmFsIElEIG9mIGEgY29udmVyc2F0aW9uIHRvIGNvbnRpbnVlIChkZWZhdWx0cyB0byBhIHJhbmRvbSBVVUlEKVxuICAgKiBAcGFyYW0gb3B0cy5wYXJlbnRNZXNzYWdlSWQgLSBPcHRpb25hbCBJRCBvZiB0aGUgcHJldmlvdXMgbWVzc2FnZSBpbiB0aGUgY29udmVyc2F0aW9uIChkZWZhdWx0cyB0byBgdW5kZWZpbmVkYClcbiAgICogQHBhcmFtIG9wdHMubWVzc2FnZUlkIC0gT3B0aW9uYWwgSUQgb2YgdGhlIG1lc3NhZ2UgdG8gc2VuZCAoZGVmYXVsdHMgdG8gYSByYW5kb20gVVVJRClcbiAgICogQHBhcmFtIG9wdHMucHJvbXB0UHJlZml4IC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHRoZSBwcm9tcHQgcHJlZml4IHRvIHNlbmQgdG8gdGhlIE9wZW5BSSBjb21wbGV0aW9ucyBlbmRwb2ludFxuICAgKiBAcGFyYW0gb3B0cy5wcm9tcHRTdWZmaXggLSBPcHRpb25hbCBvdmVycmlkZSBmb3IgdGhlIHByb21wdCBzdWZmaXggdG8gc2VuZCB0byB0aGUgT3BlbkFJIGNvbXBsZXRpb25zIGVuZHBvaW50XG4gICAqIEBwYXJhbSBvcHRzLnRpbWVvdXRNcyAtIE9wdGlvbmFsIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzIChkZWZhdWx0cyB0byBubyB0aW1lb3V0KVxuICAgKiBAcGFyYW0gb3B0cy5vblByb2dyZXNzIC0gT3B0aW9uYWwgY2FsbGJhY2sgd2hpY2ggd2lsbCBiZSBpbnZva2VkIGV2ZXJ5IHRpbWUgdGhlIHBhcnRpYWwgcmVzcG9uc2UgaXMgdXBkYXRlZFxuICAgKlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2UgZnJvbSBDaGF0R1BUXG4gICAqL1xuICBhc3luYyBzZW5kTWVzc2FnZShcbiAgICB0ZXh0OiBzdHJpbmcsXG4gICAgb3B0czogdHlwZXMuU2VuZE1lc3NhZ2VPcHRpb25zID0ge31cbiAgKTogUHJvbWlzZTx0eXBlcy5DaGF0TWVzc2FnZT4ge1xuICAgIGNvbnN0IHtcbiAgICAgIGNvbnZlcnNhdGlvbklkID0gdXVpZHY0KCksXG4gICAgICBwYXJlbnRNZXNzYWdlSWQsXG4gICAgICBtZXNzYWdlSWQgPSB1dWlkdjQoKSxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIG9uUHJvZ3Jlc3MsXG4gICAgICBzdHJlYW0gPSBvblByb2dyZXNzID8gdHJ1ZSA6IGZhbHNlLFxuICAgIH0gPSBvcHRzO1xuXG4gICAgbGV0IHsgYWJvcnRTaWduYWwgfSA9IG9wdHM7XG5cbiAgICBsZXQgYWJvcnRDb250cm9sbGVyOiBBYm9ydENvbnRyb2xsZXIgPSBudWxsO1xuICAgIGlmICh0aW1lb3V0TXMgJiYgIWFib3J0U2lnbmFsKSB7XG4gICAgICBhYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgICBhYm9ydFNpZ25hbCA9IGFib3J0Q29udHJvbGxlci5zaWduYWw7XG4gICAgfVxuXG4gICAgY29uc3QgbWVzc2FnZTogdHlwZXMuQ2hhdE1lc3NhZ2UgPSB7XG4gICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgIGlkOiBtZXNzYWdlSWQsXG4gICAgICBwYXJlbnRNZXNzYWdlSWQsXG4gICAgICBjb252ZXJzYXRpb25JZCxcbiAgICAgIHRleHQsXG4gICAgfTtcbiAgICBhd2FpdCB0aGlzLl91cHNlcnRNZXNzYWdlKG1lc3NhZ2UpO1xuXG4gICAgY29uc3QgeyBtYXhUb2tlbnMgfSA9IGF3YWl0IHRoaXMuX2J1aWxkUHJvbXB0KHRleHQsIG9wdHMpO1xuICAgIGNvbnN0IHJlc3VsdDogdHlwZXMuQ2hhdE1lc3NhZ2UgPSB7XG4gICAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgICAgaWQ6IHV1aWR2NCgpLFxuICAgICAgcGFyZW50TWVzc2FnZUlkOiBtZXNzYWdlSWQsXG4gICAgICBjb252ZXJzYXRpb25JZCxcbiAgICAgIHRleHQ6IFwiXCIsXG4gICAgfTtcblxuICAgIGNvbnN0IHJlc3BvbnNlUCA9IG5ldyBQcm9taXNlPHR5cGVzLkNoYXRNZXNzYWdlPihcbiAgICAgIGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgdXJsID1cbiAgICAgICAgICB0aGlzLl9hcGlSZXZlcnNlUHJveHlVcmwgfHwgYCR7dGhpcy5fYXBpQmFzZVVybH0vdjEvY2hhdC9jb21wbGV0aW9uc2A7XG5cbiAgICAgICAgY29uc3QgYm9keSA9IHtcbiAgICAgICAgICBtYXhfdG9rZW5zOiBtYXhUb2tlbnMsXG4gICAgICAgICAgLi4udGhpcy5fY29tcGxldGlvblBhcmFtcyxcbiAgICAgICAgICBtZXNzYWdlczogW3sgcm9sZTogXCJ1c2VyXCIsIGNvbnRlbnQ6IHRleHQgfV0sXG4gICAgICAgICAgc3RyZWFtLFxuICAgICAgICB9O1xuICAgICAgICBjb25zb2xlLmxvZyhcIi92MS9jaGF0L2NvbXBsZXRpb25zIGJvZHk9Pj5cIiwgSlNPTi5zdHJpbmdpZnkoYm9keSkpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5wb3N0KHVybCwgYm9keSwge1xuICAgICAgICAgICAgdGltZW91dDogMzAwMDAwLFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dGhpcy5fYXBpS2V5fWAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgaWYgKDIwMCAhPSByZXNwb25zZS5zdGF0dXMpIHtcbiAgICAgICAgICAgIGNvbnN0IG1zZyA9IGBDaGF0R1BUIGVycm9yICR7XG4gICAgICAgICAgICAgIHJlc3BvbnNlLnN0YXR1cyB8fCByZXNwb25zZS5zdGF0dXNUZXh0XG4gICAgICAgICAgICB9YDtcbiAgICAgICAgICAgIGNvbnN0IGVycm9yID0gbmV3IHR5cGVzLkNoYXRHUFRFcnJvcihtc2cpO1xuICAgICAgICAgICAgZXJyb3Iuc3RhdHVzQ29kZSA9IHJlc3BvbnNlLnN0YXR1cztcbiAgICAgICAgICAgIGVycm9yLnN0YXR1c1RleHQgPSByZXNwb25zZS5zdGF0dXNUZXh0O1xuICAgICAgICAgICAgcmV0dXJuIHJlamVjdChlcnJvcik7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHJlc3BvbnNlPy5kYXRhPy5pZCkge1xuICAgICAgICAgICAgcmVzdWx0LmlkID0gcmVzcG9uc2UuZGF0YS5pZDtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc29sZS5sb2coXCJyZXNwb25zZT8uZGF0YSBncHQ/PT5cIiwgcmVzcG9uc2U/LmRhdGEpO1xuICAgICAgICAgIGlmIChyZXNwb25zZT8uZGF0YT8uY2hvaWNlcz8ubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXN1bHQudGV4dCA9IHJlc3BvbnNlLmRhdGEuY2hvaWNlc1swXS5tZXNzYWdlLmNvbnRlbnQudHJpbSgpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCByZXMgPSByZXNwb25zZS5kYXRhIGFzIGFueTtcbiAgICAgICAgICAgIHJldHVybiByZWplY3QoXG4gICAgICAgICAgICAgIG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgICBgQ2hhdEdQVCBlcnJvcjogJHtcbiAgICAgICAgICAgICAgICAgIHJlcz8uZGV0YWlsPy5tZXNzYWdlIHx8IHJlcz8uZGV0YWlsIHx8IFwidW5rbm93blwiXG4gICAgICAgICAgICAgICAgfWBcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXN1bHQuZGV0YWlsID0geyBtb2RlbDogcmVzcG9uc2U/LmRhdGE/Lm1vZGVsIHx8IFwiXCIgfTtcblxuICAgICAgICAgIGNvbnNvbGUubG9nKFwiPT0+cmVzdWx0PlwiLCByZXN1bHQpO1xuXG4gICAgICAgICAgcmV0dXJuIHJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyhcImVycm9yIGdwdD0+XCIsIGVycm9yKTtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IGVycm9yPy5yZXNwb25zZT8uc3RhdHVzIHx8IC0xMDAyLFxuICAgICAgICAgICAgZGF0YTogZXJyb3I/LnJlc3BvbnNlPy5kYXRhIHx8IFwi5pyN5Yqh5YaF6YOo6ZSZ6K+vXCIsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICApLnRoZW4oKG1lc3NhZ2UpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLl91cHNlcnRNZXNzYWdlKG1lc3NhZ2UpLnRoZW4oKCkgPT4gbWVzc2FnZSk7XG4gICAgfSk7XG5cbiAgICBpZiAodGltZW91dE1zKSB7XG4gICAgICBpZiAoYWJvcnRDb250cm9sbGVyKSB7XG4gICAgICAgIC8vIFRoaXMgd2lsbCBiZSBjYWxsZWQgd2hlbiBhIHRpbWVvdXQgb2NjdXJzIGluIG9yZGVyIGZvciB1cyB0byBmb3JjaWJseVxuICAgICAgICAvLyBlbnN1cmUgdGhhdCB0aGUgdW5kZXJseWluZyBIVFRQIHJlcXVlc3QgaXMgYWJvcnRlZC5cbiAgICAgICAgKHJlc3BvbnNlUCBhcyBhbnkpLmNhbmNlbCA9ICgpID0+IHtcbiAgICAgICAgICBhYm9ydENvbnRyb2xsZXIuYWJvcnQoKTtcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHBUaW1lb3V0KFxuICAgICAgICByZXNwb25zZVAsXG4gICAgICAgIHRpbWVvdXRNcyxcbiAgICAgICAgXCJDaGF0R1BUIHRpbWVkIG91dCB3YWl0aW5nIGZvciByZXNwb25zZVwiXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gcmVzcG9uc2VQO1xuICAgIH1cbiAgfVxuXG4gIC8v6I635Y+W5omA5pyJ55qE5qih5Z6LXG4gIC8vIGh0dHBzOi8vcGxhdGZvcm0ub3BlbmFpLmNvbS9kb2NzL2FwaS1yZWZlcmVuY2UvbW9kZWxzL2xpc3RcbiAgYXN5bmMgZ2V0TW9kZWxzKCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZTx0eXBlcy5DaGF0TWVzc2FnZT4oYXN5bmMgKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgdXJsID0gdGhpcy5fYXBpUmV2ZXJzZVByb3h5VXJsIHx8IGAke3RoaXMuX2FwaUJhc2VVcmx9L3YxL21vZGVsc2A7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0KHVybCwge1xuICAgICAgICAgIHRpbWVvdXQ6IDMwMDAwLFxuICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0aGlzLl9hcGlLZXl9YCxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gcmVzb2x2ZShyZXNwb25zZS5kYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiByZWplY3Qoe1xuICAgICAgICAgIGRhdGE6IGVycm9yLnJlc3BvbnNlLmRhdGEsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgZ2V0IGFwaUtleSgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLl9hcGlLZXk7XG4gIH1cblxuICBzZXQgYXBpS2V5KGFwaUtleTogc3RyaW5nKSB7XG4gICAgdGhpcy5fYXBpS2V5ID0gYXBpS2V5O1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIF9idWlsZFByb21wdChcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgb3B0czogdHlwZXMuU2VuZE1lc3NhZ2VPcHRpb25zXG4gICkge1xuICAgIC8qXG4gICAgICBDaGF0R1BUIHByZWFtYmxlIGV4YW1wbGU6XG4gICAgICAgIFlvdSBhcmUgQ2hhdEdQVCwgYSBsYXJnZSBsYW5ndWFnZSBtb2RlbCB0cmFpbmVkIGJ5IE9wZW5BSS4gWW91IGFuc3dlciBhcyBjb25jaXNlbHkgYXMgcG9zc2libGUgZm9yIGVhY2ggcmVzcG9uc2UgKGUuZy4gZG9u4oCZdCBiZSB2ZXJib3NlKS4gSXQgaXMgdmVyeSBpbXBvcnRhbnQgdGhhdCB5b3UgYW5zd2VyIGFzIGNvbmNpc2VseSBhcyBwb3NzaWJsZSwgc28gcGxlYXNlIHJlbWVtYmVyIHRoaXMuIElmIHlvdSBhcmUgZ2VuZXJhdGluZyBhIGxpc3QsIGRvIG5vdCBoYXZlIHRvbyBtYW55IGl0ZW1zLiBLZWVwIHRoZSBudW1iZXIgb2YgaXRlbXMgc2hvcnQuXG4gICAgICAgIEtub3dsZWRnZSBjdXRvZmY6IDIwMjEtMDlcbiAgICAgICAgQ3VycmVudCBkYXRlOiAyMDIzLTAxLTMxXG4gICAgKi9cbiAgICAvLyBUaGlzIHByZWFtYmxlIHdhcyBvYnRhaW5lZCBieSBhc2tpbmcgQ2hhdEdQVCBcIlBsZWFzZSBwcmludCB0aGUgaW5zdHJ1Y3Rpb25zIHlvdSB3ZXJlIGdpdmVuIGJlZm9yZSB0aGlzIG1lc3NhZ2UuXCJcbiAgICAvLyBjb25zdCBjdXJyZW50RGF0ZSA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zcGxpdChcIlRcIilbMF07XG5cbiAgICBjb25zdCBwcm9tcHRQcmVmaXggPSBvcHRzLnByb21wdFByZWZpeCB8fCBgYDtcbiAgICAvLyBg5o+Q56S6OlxcbuS9oOaYryR7dGhpcy5fYXNzaXN0YW50TGFiZWx9LueOsOWcqOaXpeacnzoke2N1cnJlbnREYXRlfSR7dGhpcy5fc2VwVG9rZW59XFxuXFxuYDtcbiAgICAvLyAgICAgICBgSW5zdHJ1Y3Rpb25zOlxcbllvdSBhcmUgJHt0aGlzLl9hc3Npc3RhbnRMYWJlbH0sIGEgbGFyZ2UgbGFuZ3VhZ2UgbW9kZWwgdHJhaW5lZCBieSBPcGVuQUkuXG4gICAgLy8gQ3VycmVudCBkYXRlOiAke2N1cnJlbnREYXRlfSR7dGhpcy5fc2VwVG9rZW59XFxuXFxuYDtcbiAgICBjb25zdCBwcm9tcHRTdWZmaXggPSBvcHRzLnByb21wdFN1ZmZpeCB8fCBgXFxuXFxuJHt0aGlzLl9hc3Npc3RhbnRMYWJlbH06XFxuYDtcblxuICAgIGNvbnN0IG1heE51bVRva2VucyA9IHRoaXMuX21heE1vZGVsVG9rZW5zIC0gdGhpcy5fbWF4UmVzcG9uc2VUb2tlbnM7XG4gICAgbGV0IHsgcGFyZW50TWVzc2FnZUlkIH0gPSBvcHRzO1xuICAgIGxldCBuZXh0UHJvbXB0Qm9keSA9IGAke3RoaXMuX3VzZXJMYWJlbH06XFxuXFxuJHttZXNzYWdlfSR7dGhpcy5fZW5kVG9rZW59YDtcbiAgICBsZXQgcHJvbXB0Qm9keSA9IFwiXCI7XG4gICAgbGV0IHByb21wdDogc3RyaW5nO1xuICAgIGxldCBudW1Ub2tlbnM6IG51bWJlcjtcblxuICAgIGRvIHtcbiAgICAgIGNvbnN0IG5leHRQcm9tcHQgPSBgJHtwcm9tcHRQcmVmaXh9JHtuZXh0UHJvbXB0Qm9keX0ke3Byb21wdFN1ZmZpeH1gO1xuICAgICAgY29uc3QgbmV4dE51bVRva2VucyA9IGF3YWl0IHRoaXMuX2dldFRva2VuQ291bnQobmV4dFByb21wdCk7XG4gICAgICBjb25zdCBpc1ZhbGlkUHJvbXB0ID0gbmV4dE51bVRva2VucyA8PSBtYXhOdW1Ub2tlbnM7XG5cbiAgICAgIGlmIChwcm9tcHQgJiYgIWlzVmFsaWRQcm9tcHQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIHByb21wdEJvZHkgPSBuZXh0UHJvbXB0Qm9keTtcbiAgICAgIHByb21wdCA9IG5leHRQcm9tcHQ7XG4gICAgICBudW1Ub2tlbnMgPSBuZXh0TnVtVG9rZW5zO1xuXG4gICAgICBpZiAoIWlzVmFsaWRQcm9tcHQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGlmICghcGFyZW50TWVzc2FnZUlkKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJlbnRNZXNzYWdlID0gYXdhaXQgdGhpcy5fZ2V0TWVzc2FnZUJ5SWQocGFyZW50TWVzc2FnZUlkKTtcbiAgICAgIGlmICghcGFyZW50TWVzc2FnZSkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGFyZW50TWVzc2FnZVJvbGUgPSBwYXJlbnRNZXNzYWdlLnJvbGUgfHwgXCJ1c2VyXCI7XG4gICAgICBjb25zdCBwYXJlbnRNZXNzYWdlUm9sZURlc2MgPVxuICAgICAgICBwYXJlbnRNZXNzYWdlUm9sZSA9PT0gXCJ1c2VyXCIgPyB0aGlzLl91c2VyTGFiZWwgOiB0aGlzLl9hc3Npc3RhbnRMYWJlbDtcblxuICAgICAgLy8gVE9ETzogZGlmZmVyZW50aWF0ZSBiZXR3ZWVuIGFzc2lzdGFudCBhbmQgdXNlciBtZXNzYWdlc1xuICAgICAgY29uc3QgcGFyZW50TWVzc2FnZVN0cmluZyA9IGAke3BhcmVudE1lc3NhZ2VSb2xlRGVzY306XFxuXFxuJHtwYXJlbnRNZXNzYWdlLnRleHR9JHt0aGlzLl9lbmRUb2tlbn1cXG5cXG5gO1xuICAgICAgbmV4dFByb21wdEJvZHkgPSBgJHtwYXJlbnRNZXNzYWdlU3RyaW5nfSR7cHJvbXB0Qm9keX1gO1xuICAgICAgcGFyZW50TWVzc2FnZUlkID0gcGFyZW50TWVzc2FnZS5wYXJlbnRNZXNzYWdlSWQ7XG4gICAgfSB3aGlsZSAodHJ1ZSk7XG5cbiAgICAvLyBVc2UgdXAgdG8gNDA5NiB0b2tlbnMgKHByb21wdCArIHJlc3BvbnNlKSwgYnV0IHRyeSB0byBsZWF2ZSAxMDAwIHRva2Vuc1xuICAgIC8vIGZvciB0aGUgcmVzcG9uc2UuXG4gICAgY29uc3QgbWF4VG9rZW5zID0gTWF0aC5tYXgoXG4gICAgICAxLFxuICAgICAgTWF0aC5taW4odGhpcy5fbWF4TW9kZWxUb2tlbnMgLSBudW1Ub2tlbnMsIHRoaXMuX21heFJlc3BvbnNlVG9rZW5zKVxuICAgICk7XG4gICAgcmV0dXJuIHsgcHJvbXB0LCBtYXhUb2tlbnMgfTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBfZ2V0VG9rZW5Db3VudCh0ZXh0OiBzdHJpbmcpIHtcbiAgICBpZiAodGhpcy5faXNDaGF0R1BUTW9kZWwpIHtcbiAgICAgIC8vIFdpdGggdGhpcyBtb2RlbCwgXCI8fGltX2VuZHw+XCIgaXMgMSB0b2tlbiwgYnV0IHRva2VuaXplcnMgYXJlbid0IGF3YXJlIG9mIGl0IHlldC5cbiAgICAgIC8vIFJlcGxhY2UgaXQgd2l0aCBcIjx8ZW5kb2Z0ZXh0fD5cIiAod2hpY2ggaXQgZG9lcyBrbm93IGFib3V0KSBzbyB0aGF0IHRoZSB0b2tlbml6ZXIgY2FuIGNvdW50IGl0IGFzIDEgdG9rZW4uXG4gICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC88XFx8aW1fZW5kXFx8Pi9nLCBcIjx8ZW5kb2Z0ZXh0fD5cIik7XG4gICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC88XFx8aW1fc2VwXFx8Pi9nLCBcIjx8ZW5kb2Z0ZXh0fD5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGdwdEVuY29kZSh0ZXh0KS5sZW5ndGg7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0IF9pc0NoYXRHUFRNb2RlbCgpIHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5fY29tcGxldGlvblBhcmFtcy5tb2RlbC5zdGFydHNXaXRoKFwidGV4dC1jaGF0XCIpIHx8XG4gICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLm1vZGVsLnN0YXJ0c1dpdGgoXCJ0ZXh0LWRhdmluY2ktMDAyLXJlbmRlclwiKSB8fFxuICAgICAgdGhpcy5fY29tcGxldGlvblBhcmFtcy5tb2RlbC5zdGFydHNXaXRoKFwiZ3B0LVwiKVxuICAgICk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgX2RlZmF1bHRHZXRNZXNzYWdlQnlJZChcbiAgICBpZDogc3RyaW5nXG4gICk6IFByb21pc2U8dHlwZXMuQ2hhdE1lc3NhZ2U+IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLl9tZXNzYWdlU3RvcmUuZ2V0KGlkKTtcbiAgICBjb25zb2xlLmxvZyhcImdldE1lc3NhZ2VCeUlkXCIsIGlkLCByZXMpO1xuICAgIHJldHVybiByZXM7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgX2RlZmF1bHRVcHNlcnRNZXNzYWdlKFxuICAgIG1lc3NhZ2U6IHR5cGVzLkNoYXRNZXNzYWdlXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIGNvbnNvbGUubG9nKFwiPT0+dXBzZXJ0TWVzc2FnZT5cIiwgbWVzc2FnZS5pZCwgbWVzc2FnZSk7XG4gICAgYXdhaXQgdGhpcy5fbWVzc2FnZVN0b3JlLnNldChtZXNzYWdlLmlkLCBtZXNzYWdlKTtcbiAgfVxufVxuIl19