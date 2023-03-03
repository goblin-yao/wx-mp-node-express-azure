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
        const { apiKey, apiBaseUrl = "https://api.openai.com", apiReverseProxyUrl, debug = false, messageStore, completionParams, maxModelTokens = 4096, maxResponseTokens = 2000, userLabel = config_1.USER_LABEL_DEFAULT, assistantLabel = config_1.ASSISTANT_LABEL_DEFAULT, getMessageById = this._defaultGetMessageById, upsertMessage = this._defaultUpsertMessage, } = opts;
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
                console.log("response=>", response);
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
                console.log("response?.data?.choices=>", (_b = response === null || response === void 0 ? void 0 : response.data) === null || _b === void 0 ? void 0 : _b.choices);
                if ((_d = (_c = response === null || response === void 0 ? void 0 : response.data) === null || _c === void 0 ? void 0 : _c.choices) === null || _d === void 0 ? void 0 : _d.length) {
                    result.text = response.data.choices[0].message.content.trim();
                }
                else {
                    const res = response.data;
                    return reject(new Error(`ChatGPT error: ${((_e = res === null || res === void 0 ? void 0 : res.detail) === null || _e === void 0 ? void 0 : _e.message) || (res === null || res === void 0 ? void 0 : res.detail) || "unknown"}`));
                }
                result.detail = response.data;
                console.log("==>result>", result);
                return resolve(result);
            }
            catch (error) {
                console.log("error=>", error);
                return reject({
                    statusCode: ((_f = error === null || error === void 0 ? void 0 : error.response) === null || _f === void 0 ? void 0 : _f.status) || -1,
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
                    timeout: 300000,
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
        console.log("==>upsertMessage>", message.id, message);
        await this._messageStore.set(message.id, message);
    }
}
exports.ChatGPTAPITURBO = ChatGPTAPITURBO;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2hhdGdwdC1hcGktZ3B0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vY2hhdGdwdGxpYl9zcmMvY2hhdGdwdC1hcGktZ3B0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW9EO0FBQ3BELGdEQUF3QjtBQUN4QiwwREFBaUM7QUFDakMsK0JBQW9DO0FBRXBDLCtDQUFpQztBQUNqQyxrREFBMEI7QUFFMUIsMERBQWlDO0FBRWpDLHFDQUlrQjtBQUVsQixNQUFhLGVBQWU7SUFrQzFCLFlBQVksSUE2Qlg7UUFDQyxNQUFNLEVBQ0osTUFBTSxFQUNOLFVBQVUsR0FBRyx3QkFBd0IsRUFDckMsa0JBQWtCLEVBQ2xCLEtBQUssR0FBRyxLQUFLLEVBQ2IsWUFBWSxFQUNaLGdCQUFnQixFQUNoQixjQUFjLEdBQUcsSUFBSSxFQUNyQixpQkFBaUIsR0FBRyxJQUFJLEVBQ3hCLFNBQVMsR0FBRywyQkFBa0IsRUFDOUIsY0FBYyxHQUFHLGdDQUF1QixFQUN4QyxjQUFjLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixFQUM1QyxhQUFhLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixHQUMzQyxHQUFHLElBQUksQ0FBQztRQUVULElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDO1FBQ3RCLElBQUksQ0FBQyxXQUFXLEdBQUcsVUFBVSxDQUFDO1FBQzlCLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxrQkFBa0IsQ0FBQztRQUM5QyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUM7UUFFdEIsSUFBSSxDQUFDLGlCQUFpQixtQkFDcEIsS0FBSyxFQUFFLDBCQUFpQixFQUN4QixXQUFXLEVBQUUsR0FBRyxFQUNoQixLQUFLLEVBQUUsR0FBRyxFQUNWLGdCQUFnQixFQUFFLEdBQUcsSUFDbEIsZ0JBQWdCLENBQ3BCLENBQUM7UUFFRixJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUU7WUFDeEIs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Q0FBQyxlQUFlLEVBQUUsZUFBZSxDQUFDLENBQUM7WUFDdEQsSUFBSSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsZUFBZSxFQUFFLGVBQWUsQ0FBQyxDQUFDO1NBQ3ZEO1FBRUQsT0FBTyxJQUFBLHNCQUFTLEVBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDO0lBQ2hDLENBQUM7SUFFRCxJQUFjLGVBQWU7UUFDM0IsT0FBTyxDQUNMLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQztZQUNwRCxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyx5QkFBeUIsQ0FBQztZQUNsRSxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FDaEQsQ0FBQztJQUNKLENBQUM7SUFFUyxLQUFLLENBQUMsc0JBQXNCLENBQ3BDLEVBQVU7UUFFVixNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQzdDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLEVBQUUsRUFBRSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ3ZDLE9BQU8sR0FBRyxDQUFDO0lBQ2IsQ0FBQztJQUVTLEtBQUssQ0FBQyxxQkFBcUIsQ0FDbkMsT0FBMEI7UUFFMUIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsRUFBRSxPQUFPLENBQUMsRUFBRSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQ3RELE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUUsRUFBRSxPQUFPLENBQUMsQ0FBQztJQUNwRCxDQUFDO0NBQ0Y7QUE3WkQsMENBNlpDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZW5jb2RlIGFzIGdwdEVuY29kZSB9IGZyb20gXCJncHQtMy1lbmNvZGVyXCI7XG5pbXBvcnQgS2V5diBmcm9tIFwia2V5dlwiO1xuaW1wb3J0IHBUaW1lb3V0IGZyb20gXCJwLXRpbWVvdXRcIjtcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gXCJ1dWlkXCI7XG5cbmltcG9ydCAqIGFzIHR5cGVzIGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgYXhpb3MgZnJvbSBcImF4aW9zXCI7XG5cbmltcG9ydCBRdWlja0xSVSBmcm9tIFwicXVpY2stbHJ1XCI7XG5cbmltcG9ydCB7XG4gIENIQVRHUFRfTU9ERUxfR1BULFxuICBVU0VSX0xBQkVMX0RFRkFVTFQsXG4gIEFTU0lTVEFOVF9MQUJFTF9ERUZBVUxULFxufSBmcm9tIFwiLi9jb25maWdcIjtcblxuZXhwb3J0IGNsYXNzIENoYXRHUFRBUElUVVJCTyB7XG4gIHByb3RlY3RlZCBfYXBpS2V5OiBzdHJpbmc7XG4gIHByb3RlY3RlZCBfYXBpQmFzZVVybDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2FwaVJldmVyc2VQcm94eVVybDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2RlYnVnOiBib29sZWFuO1xuXG4gIHByb3RlY3RlZCBfY29tcGxldGlvblBhcmFtczogT21pdDx0eXBlcy5vcGVuYWkuQ29tcGxldGlvblBhcmFtcywgXCJwcm9tcHRcIj47XG4gIHByb3RlY3RlZCBfbWF4TW9kZWxUb2tlbnM6IG51bWJlcjtcbiAgcHJvdGVjdGVkIF9tYXhSZXNwb25zZVRva2VuczogbnVtYmVyO1xuICBwcm90ZWN0ZWQgX3VzZXJMYWJlbDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2Fzc2lzdGFudExhYmVsOiBzdHJpbmc7XG4gIHByb3RlY3RlZCBfZW5kVG9rZW46IHN0cmluZztcbiAgcHJvdGVjdGVkIF9zZXBUb2tlbjogc3RyaW5nO1xuXG4gIHByb3RlY3RlZCBfZ2V0TWVzc2FnZUJ5SWQ6IHR5cGVzLkdldE1lc3NhZ2VCeUlkRnVuY3Rpb247XG4gIHByb3RlY3RlZCBfdXBzZXJ0TWVzc2FnZTogdHlwZXMuVXBzZXJ0TWVzc2FnZUZ1bmN0aW9uO1xuXG4gIHByb3RlY3RlZCBfbWVzc2FnZVN0b3JlOiBLZXl2PHR5cGVzLkNoYXRNZXNzYWdlPjtcblxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBjbGllbnQgd3JhcHBlciBhcm91bmQgT3BlbkFJJ3MgY29tcGxldGlvbiBBUEkgdXNpbmcgdGhlXG4gICAqIHVub2ZmaWNpYWwgQ2hhdEdQVCBtb2RlbC5cbiAgICpcbiAgICogQHBhcmFtIGFwaUtleSAtIE9wZW5BSSBBUEkga2V5IChyZXF1aXJlZCkuXG4gICAqIEBwYXJhbSBhcGlCYXNlVXJsIC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHRoZSBPcGVuQUkgQVBJIGJhc2UgVVJMLlxuICAgKiBAcGFyYW0gYXBpUmV2ZXJzZVByb3h5VXJsIC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIGEgcmV2ZXJzZSBwcm94eSBVUkwgdG8gdXNlIGluc3RlYWQgb2YgdGhlIE9wZW5BSSBBUEkgY29tcGxldGlvbnMgQVBJLlxuICAgKiBAcGFyYW0gZGVidWcgLSBPcHRpb25hbCBlbmFibGVzIGxvZ2dpbmcgZGVidWdnaW5nIGluZm8gdG8gc3Rkb3V0LlxuICAgKiBAcGFyYW0gY29tcGxldGlvblBhcmFtcyAtIFBhcmFtIG92ZXJyaWRlcyB0byBzZW5kIHRvIHRoZSBbT3BlbkFJIGNvbXBsZXRpb24gQVBJXShodHRwczovL3BsYXRmb3JtLm9wZW5haS5jb20vZG9jcy9hcGktcmVmZXJlbmNlL2NvbXBsZXRpb25zL2NyZWF0ZSkuIE9wdGlvbnMgbGlrZSBgdGVtcGVyYXR1cmVgIGFuZCBgcHJlc2VuY2VfcGVuYWx0eWAgY2FuIGJlIHR3ZWFrZWQgdG8gY2hhbmdlIHRoZSBwZXJzb25hbGl0eSBvZiB0aGUgYXNzaXN0YW50LlxuICAgKiBAcGFyYW0gbWF4TW9kZWxUb2tlbnMgLSBPcHRpb25hbCBvdmVycmlkZSBmb3IgdGhlIG1heGltdW0gbnVtYmVyIG9mIHRva2VucyBhbGxvd2VkIGJ5IHRoZSBtb2RlbCdzIGNvbnRleHQuIERlZmF1bHRzIHRvIDQwOTYgZm9yIHRoZSBgdGV4dC1jaGF0LWRhdmluY2ktMDAyLTIwMjMwMTI2YCBtb2RlbC5cbiAgICogQHBhcmFtIG1heFJlc3BvbnNlVG9rZW5zIC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHRoZSBtaW5pbXVtIG51bWJlciBvZiB0b2tlbnMgYWxsb3dlZCBmb3IgdGhlIG1vZGVsJ3MgcmVzcG9uc2UuIERlZmF1bHRzIHRvIDEwMDAgZm9yIHRoZSBgdGV4dC1jaGF0LWRhdmluY2ktMDAyLTIwMjMwMTI2YCBtb2RlbC5cbiAgICogQHBhcmFtIG1lc3NhZ2VTdG9yZSAtIE9wdGlvbmFsIFtLZXl2XShodHRwczovL2dpdGh1Yi5jb20vamFyZWR3cmF5L2tleXYpIHN0b3JlIHRvIHBlcnNpc3QgY2hhdCBtZXNzYWdlcyB0by4gSWYgbm90IHByb3ZpZGVkLCBtZXNzYWdlcyB3aWxsIGJlIGxvc3Qgd2hlbiB0aGUgcHJvY2VzcyBleGl0cy5cbiAgICogQHBhcmFtIGdldE1lc3NhZ2VCeUlkIC0gT3B0aW9uYWwgZnVuY3Rpb24gdG8gcmV0cmlldmUgYSBtZXNzYWdlIGJ5IGl0cyBJRC4gSWYgbm90IHByb3ZpZGVkLCB0aGUgZGVmYXVsdCBpbXBsZW1lbnRhdGlvbiB3aWxsIGJlIHVzZWQgKHVzaW5nIGFuIGluLW1lbW9yeSBgbWVzc2FnZVN0b3JlYCkuXG4gICAqIEBwYXJhbSB1cHNlcnRNZXNzYWdlIC0gT3B0aW9uYWwgZnVuY3Rpb24gdG8gaW5zZXJ0IG9yIHVwZGF0ZSBhIG1lc3NhZ2UuIElmIG5vdCBwcm92aWRlZCwgdGhlIGRlZmF1bHQgaW1wbGVtZW50YXRpb24gd2lsbCBiZSB1c2VkICh1c2luZyBhbiBpbi1tZW1vcnkgYG1lc3NhZ2VTdG9yZWApLlxuICAgKi9cbiAgY29uc3RydWN0b3Iob3B0czoge1xuICAgIGFwaUtleTogc3RyaW5nO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYCdodHRwczovL2FwaS5vcGVuYWkuY29tJ2AgKiovXG4gICAgYXBpQmFzZVVybD86IHN0cmluZztcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGB1bmRlZmluZWRgICoqL1xuICAgIGFwaVJldmVyc2VQcm94eVVybD86IHN0cmluZztcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGBmYWxzZWAgKiovXG4gICAgZGVidWc/OiBib29sZWFuO1xuXG4gICAgY29tcGxldGlvblBhcmFtcz86IFBhcnRpYWw8dHlwZXMub3BlbmFpLkNvbXBsZXRpb25QYXJhbXM+O1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYDQwOTZgICoqL1xuICAgIG1heE1vZGVsVG9rZW5zPzogbnVtYmVyO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYDEwMDBgICoqL1xuICAgIG1heFJlc3BvbnNlVG9rZW5zPzogbnVtYmVyO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYCdVc2VyJ2AgKiovXG4gICAgdXNlckxhYmVsPzogc3RyaW5nO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYCdDaGF0R1BUJ2AgKiovXG4gICAgYXNzaXN0YW50TGFiZWw/OiBzdHJpbmc7XG5cbiAgICBtZXNzYWdlU3RvcmU/OiBLZXl2O1xuICAgIGdldE1lc3NhZ2VCeUlkPzogdHlwZXMuR2V0TWVzc2FnZUJ5SWRGdW5jdGlvbjtcbiAgICB1cHNlcnRNZXNzYWdlPzogdHlwZXMuVXBzZXJ0TWVzc2FnZUZ1bmN0aW9uO1xuICB9KSB7XG4gICAgY29uc3Qge1xuICAgICAgYXBpS2V5LFxuICAgICAgYXBpQmFzZVVybCA9IFwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbVwiLFxuICAgICAgYXBpUmV2ZXJzZVByb3h5VXJsLFxuICAgICAgZGVidWcgPSBmYWxzZSxcbiAgICAgIG1lc3NhZ2VTdG9yZSxcbiAgICAgIGNvbXBsZXRpb25QYXJhbXMsXG4gICAgICBtYXhNb2RlbFRva2VucyA9IDQwOTYsIC8vNDA5NlxuICAgICAgbWF4UmVzcG9uc2VUb2tlbnMgPSAyMDAwLCAvLzEwMDBcbiAgICAgIHVzZXJMYWJlbCA9IFVTRVJfTEFCRUxfREVGQVVMVCxcbiAgICAgIGFzc2lzdGFudExhYmVsID0gQVNTSVNUQU5UX0xBQkVMX0RFRkFVTFQsXG4gICAgICBnZXRNZXNzYWdlQnlJZCA9IHRoaXMuX2RlZmF1bHRHZXRNZXNzYWdlQnlJZCxcbiAgICAgIHVwc2VydE1lc3NhZ2UgPSB0aGlzLl9kZWZhdWx0VXBzZXJ0TWVzc2FnZSxcbiAgICB9ID0gb3B0cztcblxuICAgIHRoaXMuX2FwaUtleSA9IGFwaUtleTtcbiAgICB0aGlzLl9hcGlCYXNlVXJsID0gYXBpQmFzZVVybDtcbiAgICB0aGlzLl9hcGlSZXZlcnNlUHJveHlVcmwgPSBhcGlSZXZlcnNlUHJveHlVcmw7XG4gICAgdGhpcy5fZGVidWcgPSAhIWRlYnVnO1xuXG4gICAgdGhpcy5fY29tcGxldGlvblBhcmFtcyA9IHtcbiAgICAgIG1vZGVsOiBDSEFUR1BUX01PREVMX0dQVCxcbiAgICAgIHRlbXBlcmF0dXJlOiAwLjQsIC8vIDAuMiDkvb/nlKjku4DkuYjph4fmoLfmuKnluqbvvIzku4vkuo4gMCDlkowgMiDkuYvpl7TjgILovoPpq5jnmoTlgLzvvIjlpoIgMC4477yJ5bCG5L2/6L6T5Ye65pu05Yqg6ZqP5py677yM6ICM6L6D5L2O55qE5YC877yI5aaCIDAuMu+8ieWwhuS9v+i+k+WHuuabtOWKoOmbhuS4reWSjOehruWumuOAglxuICAgICAgdG9wX3A6IDEuMCxcbiAgICAgIHByZXNlbmNlX3BlbmFsdHk6IDEuMCxcbiAgICAgIC4uLmNvbXBsZXRpb25QYXJhbXMsXG4gICAgfTtcblxuICAgIGlmICh0aGlzLl9pc0NoYXRHUFRNb2RlbCkge1xuICAgICAgdGhpcy5fZW5kVG9rZW4gPSBcIjx8aW1fZW5kfD5cIjtcbiAgICAgIHRoaXMuX3NlcFRva2VuID0gXCI8fGltX3NlcHw+XCI7XG5cbiAgICAgIGlmICghdGhpcy5fY29tcGxldGlvblBhcmFtcy5zdG9wKSB7XG4gICAgICAgIHRoaXMuX2NvbXBsZXRpb25QYXJhbXMuc3RvcCA9IFt0aGlzLl9lbmRUb2tlbiwgdGhpcy5fc2VwVG9rZW5dO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9lbmRUb2tlbiA9IFwiPHxlbmRvZnRleHR8PlwiO1xuICAgICAgdGhpcy5fc2VwVG9rZW4gPSB0aGlzLl9lbmRUb2tlbjtcblxuICAgICAgaWYgKCF0aGlzLl9jb21wbGV0aW9uUGFyYW1zLnN0b3ApIHtcbiAgICAgICAgdGhpcy5fY29tcGxldGlvblBhcmFtcy5zdG9wID0gW3RoaXMuX2VuZFRva2VuXTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9tYXhNb2RlbFRva2VucyA9IG1heE1vZGVsVG9rZW5zO1xuICAgIHRoaXMuX21heFJlc3BvbnNlVG9rZW5zID0gbWF4UmVzcG9uc2VUb2tlbnM7XG4gICAgdGhpcy5fdXNlckxhYmVsID0gdXNlckxhYmVsO1xuICAgIHRoaXMuX2Fzc2lzdGFudExhYmVsID0gYXNzaXN0YW50TGFiZWw7XG5cbiAgICB0aGlzLl9nZXRNZXNzYWdlQnlJZCA9IGdldE1lc3NhZ2VCeUlkO1xuICAgIHRoaXMuX3Vwc2VydE1lc3NhZ2UgPSB1cHNlcnRNZXNzYWdlO1xuXG4gICAgaWYgKG1lc3NhZ2VTdG9yZSkge1xuICAgICAgdGhpcy5fbWVzc2FnZVN0b3JlID0gbWVzc2FnZVN0b3JlO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9tZXNzYWdlU3RvcmUgPSBuZXcgS2V5djx0eXBlcy5DaGF0TWVzc2FnZSwgYW55Pih7XG4gICAgICAgIHN0b3JlOiBuZXcgUXVpY2tMUlU8c3RyaW5nLCB0eXBlcy5DaGF0TWVzc2FnZT4oeyBtYXhTaXplOiAxMDAwMCB9KSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5fYXBpS2V5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDaGF0R1BUIGludmFsaWQgYXBpS2V5XCIpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyBhIG1lc3NhZ2UgdG8gQ2hhdEdQVCwgd2FpdHMgZm9yIHRoZSByZXNwb25zZSB0byByZXNvbHZlLCBhbmQgcmV0dXJuc1xuICAgKiB0aGUgcmVzcG9uc2UuXG4gICAqXG4gICAqIElmIHlvdSB3YW50IHlvdXIgcmVzcG9uc2UgdG8gaGF2ZSBoaXN0b3JpY2FsIGNvbnRleHQsIHlvdSBtdXN0IHByb3ZpZGUgYSB2YWxpZCBgcGFyZW50TWVzc2FnZUlkYC5cbiAgICpcbiAgICogSWYgeW91IHdhbnQgdG8gcmVjZWl2ZSBhIHN0cmVhbSBvZiBwYXJ0aWFsIHJlc3BvbnNlcywgdXNlIGBvcHRzLm9uUHJvZ3Jlc3NgLlxuICAgKiBJZiB5b3Ugd2FudCB0byByZWNlaXZlIHRoZSBmdWxsIHJlc3BvbnNlLCBpbmNsdWRpbmcgbWVzc2FnZSBhbmQgY29udmVyc2F0aW9uIElEcyxcbiAgICogeW91IGNhbiB1c2UgYG9wdHMub25Db252ZXJzYXRpb25SZXNwb25zZWAgb3IgdXNlIHRoZSBgQ2hhdEdQVEFQSVRVUkJPLmdldENvbnZlcnNhdGlvbmBcbiAgICogaGVscGVyLlxuICAgKlxuICAgKiBTZXQgYGRlYnVnOiB0cnVlYCBpbiB0aGUgYENoYXRHUFRBUElUVVJCT2AgY29uc3RydWN0b3IgdG8gbG9nIG1vcmUgaW5mbyBvbiB0aGUgZnVsbCBwcm9tcHQgc2VudCB0byB0aGUgT3BlbkFJIGNvbXBsZXRpb25zIEFQSS4gWW91IGNhbiBvdmVycmlkZSB0aGUgYHByb21wdFByZWZpeGAgYW5kIGBwcm9tcHRTdWZmaXhgIGluIGBvcHRzYCB0byBjdXN0b21pemUgdGhlIHByb21wdC5cbiAgICpcbiAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgcHJvbXB0IG1lc3NhZ2UgdG8gc2VuZFxuICAgKiBAcGFyYW0gb3B0cy5jb252ZXJzYXRpb25JZCAtIE9wdGlvbmFsIElEIG9mIGEgY29udmVyc2F0aW9uIHRvIGNvbnRpbnVlIChkZWZhdWx0cyB0byBhIHJhbmRvbSBVVUlEKVxuICAgKiBAcGFyYW0gb3B0cy5wYXJlbnRNZXNzYWdlSWQgLSBPcHRpb25hbCBJRCBvZiB0aGUgcHJldmlvdXMgbWVzc2FnZSBpbiB0aGUgY29udmVyc2F0aW9uIChkZWZhdWx0cyB0byBgdW5kZWZpbmVkYClcbiAgICogQHBhcmFtIG9wdHMubWVzc2FnZUlkIC0gT3B0aW9uYWwgSUQgb2YgdGhlIG1lc3NhZ2UgdG8gc2VuZCAoZGVmYXVsdHMgdG8gYSByYW5kb20gVVVJRClcbiAgICogQHBhcmFtIG9wdHMucHJvbXB0UHJlZml4IC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHRoZSBwcm9tcHQgcHJlZml4IHRvIHNlbmQgdG8gdGhlIE9wZW5BSSBjb21wbGV0aW9ucyBlbmRwb2ludFxuICAgKiBAcGFyYW0gb3B0cy5wcm9tcHRTdWZmaXggLSBPcHRpb25hbCBvdmVycmlkZSBmb3IgdGhlIHByb21wdCBzdWZmaXggdG8gc2VuZCB0byB0aGUgT3BlbkFJIGNvbXBsZXRpb25zIGVuZHBvaW50XG4gICAqIEBwYXJhbSBvcHRzLnRpbWVvdXRNcyAtIE9wdGlvbmFsIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzIChkZWZhdWx0cyB0byBubyB0aW1lb3V0KVxuICAgKiBAcGFyYW0gb3B0cy5vblByb2dyZXNzIC0gT3B0aW9uYWwgY2FsbGJhY2sgd2hpY2ggd2lsbCBiZSBpbnZva2VkIGV2ZXJ5IHRpbWUgdGhlIHBhcnRpYWwgcmVzcG9uc2UgaXMgdXBkYXRlZFxuICAgKlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2UgZnJvbSBDaGF0R1BUXG4gICAqL1xuICBhc3luYyBzZW5kTWVzc2FnZShcbiAgICB0ZXh0OiBzdHJpbmcsXG4gICAgb3B0czogdHlwZXMuU2VuZE1lc3NhZ2VPcHRpb25zID0ge31cbiAgKTogUHJvbWlzZTx0eXBlcy5DaGF0TWVzc2FnZT4ge1xuICAgIGNvbnN0IHtcbiAgICAgIGNvbnZlcnNhdGlvbklkID0gdXVpZHY0KCksXG4gICAgICBwYXJlbnRNZXNzYWdlSWQsXG4gICAgICBtZXNzYWdlSWQgPSB1dWlkdjQoKSxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIG9uUHJvZ3Jlc3MsXG4gICAgICBzdHJlYW0gPSBvblByb2dyZXNzID8gdHJ1ZSA6IGZhbHNlLFxuICAgIH0gPSBvcHRzO1xuXG4gICAgbGV0IHsgYWJvcnRTaWduYWwgfSA9IG9wdHM7XG5cbiAgICBsZXQgYWJvcnRDb250cm9sbGVyOiBBYm9ydENvbnRyb2xsZXIgPSBudWxsO1xuICAgIGlmICh0aW1lb3V0TXMgJiYgIWFib3J0U2lnbmFsKSB7XG4gICAgICBhYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgICBhYm9ydFNpZ25hbCA9IGFib3J0Q29udHJvbGxlci5zaWduYWw7XG4gICAgfVxuXG4gICAgY29uc3QgbWVzc2FnZTogdHlwZXMuQ2hhdE1lc3NhZ2UgPSB7XG4gICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgIGlkOiBtZXNzYWdlSWQsXG4gICAgICBwYXJlbnRNZXNzYWdlSWQsXG4gICAgICBjb252ZXJzYXRpb25JZCxcbiAgICAgIHRleHQsXG4gICAgfTtcbiAgICBhd2FpdCB0aGlzLl91cHNlcnRNZXNzYWdlKG1lc3NhZ2UpO1xuXG4gICAgY29uc3QgeyBtYXhUb2tlbnMgfSA9IGF3YWl0IHRoaXMuX2J1aWxkUHJvbXB0KHRleHQsIG9wdHMpO1xuICAgIGNvbnN0IHJlc3VsdDogdHlwZXMuQ2hhdE1lc3NhZ2UgPSB7XG4gICAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgICAgaWQ6IHV1aWR2NCgpLFxuICAgICAgcGFyZW50TWVzc2FnZUlkOiBtZXNzYWdlSWQsXG4gICAgICBjb252ZXJzYXRpb25JZCxcbiAgICAgIHRleHQ6IFwiXCIsXG4gICAgfTtcblxuICAgIGNvbnN0IHJlc3BvbnNlUCA9IG5ldyBQcm9taXNlPHR5cGVzLkNoYXRNZXNzYWdlPihcbiAgICAgIGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgdXJsID1cbiAgICAgICAgICB0aGlzLl9hcGlSZXZlcnNlUHJveHlVcmwgfHwgYCR7dGhpcy5fYXBpQmFzZVVybH0vdjEvY2hhdC9jb21wbGV0aW9uc2A7XG5cbiAgICAgICAgY29uc3QgYm9keSA9IHtcbiAgICAgICAgICBtYXhfdG9rZW5zOiBtYXhUb2tlbnMsXG4gICAgICAgICAgLi4udGhpcy5fY29tcGxldGlvblBhcmFtcyxcbiAgICAgICAgICBtZXNzYWdlczogW3sgcm9sZTogXCJ1c2VyXCIsIGNvbnRlbnQ6IHRleHQgfV0sXG4gICAgICAgICAgc3RyZWFtLFxuICAgICAgICB9O1xuICAgICAgICBjb25zb2xlLmxvZyhcIi92MS9jaGF0L2NvbXBsZXRpb25zIGJvZHk9Pj5cIiwgSlNPTi5zdHJpbmdpZnkoYm9keSkpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5wb3N0KHVybCwgYm9keSwge1xuICAgICAgICAgICAgdGltZW91dDogMzAwMDAwLFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dGhpcy5fYXBpS2V5fWAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgY29uc29sZS5sb2coXCJyZXNwb25zZT0+XCIsIHJlc3BvbnNlKTtcblxuICAgICAgICAgIGlmICgyMDAgIT0gcmVzcG9uc2Uuc3RhdHVzKSB7XG4gICAgICAgICAgICBjb25zdCBtc2cgPSBgQ2hhdEdQVCBlcnJvciAke1xuICAgICAgICAgICAgICByZXNwb25zZS5zdGF0dXMgfHwgcmVzcG9uc2Uuc3RhdHVzVGV4dFxuICAgICAgICAgICAgfWA7XG4gICAgICAgICAgICBjb25zdCBlcnJvciA9IG5ldyB0eXBlcy5DaGF0R1BURXJyb3IobXNnKTtcbiAgICAgICAgICAgIGVycm9yLnN0YXR1c0NvZGUgPSByZXNwb25zZS5zdGF0dXM7XG4gICAgICAgICAgICBlcnJvci5zdGF0dXNUZXh0ID0gcmVzcG9uc2Uuc3RhdHVzVGV4dDtcbiAgICAgICAgICAgIHJldHVybiByZWplY3QoZXJyb3IpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChyZXNwb25zZT8uZGF0YT8uaWQpIHtcbiAgICAgICAgICAgIHJlc3VsdC5pZCA9IHJlc3BvbnNlLmRhdGEuaWQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnNvbGUubG9nKFwicmVzcG9uc2U/LmRhdGE/LmNob2ljZXM9PlwiLCByZXNwb25zZT8uZGF0YT8uY2hvaWNlcyk7XG4gICAgICAgICAgaWYgKHJlc3BvbnNlPy5kYXRhPy5jaG9pY2VzPy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJlc3VsdC50ZXh0ID0gcmVzcG9uc2UuZGF0YS5jaG9pY2VzWzBdLm1lc3NhZ2UuY29udGVudC50cmltKCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IHJlcyA9IHJlc3BvbnNlLmRhdGEgYXMgYW55O1xuICAgICAgICAgICAgcmV0dXJuIHJlamVjdChcbiAgICAgICAgICAgICAgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgIGBDaGF0R1BUIGVycm9yOiAke1xuICAgICAgICAgICAgICAgICAgcmVzPy5kZXRhaWw/Lm1lc3NhZ2UgfHwgcmVzPy5kZXRhaWwgfHwgXCJ1bmtub3duXCJcbiAgICAgICAgICAgICAgICB9YFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJlc3VsdC5kZXRhaWwgPSByZXNwb25zZS5kYXRhO1xuXG4gICAgICAgICAgY29uc29sZS5sb2coXCI9PT5yZXN1bHQ+XCIsIHJlc3VsdCk7XG5cbiAgICAgICAgICByZXR1cm4gcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUubG9nKFwiZXJyb3I9PlwiLCBlcnJvcik7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdCh7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiBlcnJvcj8ucmVzcG9uc2U/LnN0YXR1cyB8fCAtMSxcbiAgICAgICAgICAgIGRhdGE6IGVycm9yPy5yZXNwb25zZT8uZGF0YSB8fCBcIuacjeWKoeWGhemDqOmUmeivr1wiLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgKS50aGVuKChtZXNzYWdlKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5fdXBzZXJ0TWVzc2FnZShtZXNzYWdlKS50aGVuKCgpID0+IG1lc3NhZ2UpO1xuICAgIH0pO1xuXG4gICAgaWYgKHRpbWVvdXRNcykge1xuICAgICAgaWYgKGFib3J0Q29udHJvbGxlcikge1xuICAgICAgICAvLyBUaGlzIHdpbGwgYmUgY2FsbGVkIHdoZW4gYSB0aW1lb3V0IG9jY3VycyBpbiBvcmRlciBmb3IgdXMgdG8gZm9yY2libHlcbiAgICAgICAgLy8gZW5zdXJlIHRoYXQgdGhlIHVuZGVybHlpbmcgSFRUUCByZXF1ZXN0IGlzIGFib3J0ZWQuXG4gICAgICAgIChyZXNwb25zZVAgYXMgYW55KS5jYW5jZWwgPSAoKSA9PiB7XG4gICAgICAgICAgYWJvcnRDb250cm9sbGVyLmFib3J0KCk7XG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBwVGltZW91dChcbiAgICAgICAgcmVzcG9uc2VQLFxuICAgICAgICB0aW1lb3V0TXMsXG4gICAgICAgIFwiQ2hhdEdQVCB0aW1lZCBvdXQgd2FpdGluZyBmb3IgcmVzcG9uc2VcIlxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHJlc3BvbnNlUDtcbiAgICB9XG4gIH1cblxuICAvL+iOt+WPluaJgOacieeahOaooeWei1xuICAvLyBodHRwczovL3BsYXRmb3JtLm9wZW5haS5jb20vZG9jcy9hcGktcmVmZXJlbmNlL21vZGVscy9saXN0XG4gIGFzeW5jIGdldE1vZGVscygpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2U8dHlwZXMuQ2hhdE1lc3NhZ2U+KGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHVybCA9IHRoaXMuX2FwaVJldmVyc2VQcm94eVVybCB8fCBgJHt0aGlzLl9hcGlCYXNlVXJsfS92MS9tb2RlbHNgO1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldCh1cmwsIHtcbiAgICAgICAgICB0aW1lb3V0OiAzMDAwMDAsXG4gICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMuX2FwaUtleX1gLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXNvbHZlKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHJlamVjdCh7XG4gICAgICAgICAgZGF0YTogZXJyb3IucmVzcG9uc2UuZGF0YSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBnZXQgYXBpS2V5KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuX2FwaUtleTtcbiAgfVxuXG4gIHNldCBhcGlLZXkoYXBpS2V5OiBzdHJpbmcpIHtcbiAgICB0aGlzLl9hcGlLZXkgPSBhcGlLZXk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgX2J1aWxkUHJvbXB0KFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICBvcHRzOiB0eXBlcy5TZW5kTWVzc2FnZU9wdGlvbnNcbiAgKSB7XG4gICAgLypcbiAgICAgIENoYXRHUFQgcHJlYW1ibGUgZXhhbXBsZTpcbiAgICAgICAgWW91IGFyZSBDaGF0R1BULCBhIGxhcmdlIGxhbmd1YWdlIG1vZGVsIHRyYWluZWQgYnkgT3BlbkFJLiBZb3UgYW5zd2VyIGFzIGNvbmNpc2VseSBhcyBwb3NzaWJsZSBmb3IgZWFjaCByZXNwb25zZSAoZS5nLiBkb27igJl0IGJlIHZlcmJvc2UpLiBJdCBpcyB2ZXJ5IGltcG9ydGFudCB0aGF0IHlvdSBhbnN3ZXIgYXMgY29uY2lzZWx5IGFzIHBvc3NpYmxlLCBzbyBwbGVhc2UgcmVtZW1iZXIgdGhpcy4gSWYgeW91IGFyZSBnZW5lcmF0aW5nIGEgbGlzdCwgZG8gbm90IGhhdmUgdG9vIG1hbnkgaXRlbXMuIEtlZXAgdGhlIG51bWJlciBvZiBpdGVtcyBzaG9ydC5cbiAgICAgICAgS25vd2xlZGdlIGN1dG9mZjogMjAyMS0wOVxuICAgICAgICBDdXJyZW50IGRhdGU6IDIwMjMtMDEtMzFcbiAgICAqL1xuICAgIC8vIFRoaXMgcHJlYW1ibGUgd2FzIG9idGFpbmVkIGJ5IGFza2luZyBDaGF0R1BUIFwiUGxlYXNlIHByaW50IHRoZSBpbnN0cnVjdGlvbnMgeW91IHdlcmUgZ2l2ZW4gYmVmb3JlIHRoaXMgbWVzc2FnZS5cIlxuICAgIC8vIGNvbnN0IGN1cnJlbnREYXRlID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNwbGl0KFwiVFwiKVswXTtcblxuICAgIGNvbnN0IHByb21wdFByZWZpeCA9IG9wdHMucHJvbXB0UHJlZml4IHx8IGBgO1xuICAgIC8vIGDmj5DnpLo6XFxu5L2g5pivJHt0aGlzLl9hc3Npc3RhbnRMYWJlbH0u546w5Zyo5pel5pyfOiR7Y3VycmVudERhdGV9JHt0aGlzLl9zZXBUb2tlbn1cXG5cXG5gO1xuICAgIC8vICAgICAgIGBJbnN0cnVjdGlvbnM6XFxuWW91IGFyZSAke3RoaXMuX2Fzc2lzdGFudExhYmVsfSwgYSBsYXJnZSBsYW5ndWFnZSBtb2RlbCB0cmFpbmVkIGJ5IE9wZW5BSS5cbiAgICAvLyBDdXJyZW50IGRhdGU6ICR7Y3VycmVudERhdGV9JHt0aGlzLl9zZXBUb2tlbn1cXG5cXG5gO1xuICAgIGNvbnN0IHByb21wdFN1ZmZpeCA9IG9wdHMucHJvbXB0U3VmZml4IHx8IGBcXG5cXG4ke3RoaXMuX2Fzc2lzdGFudExhYmVsfTpcXG5gO1xuXG4gICAgY29uc3QgbWF4TnVtVG9rZW5zID0gdGhpcy5fbWF4TW9kZWxUb2tlbnMgLSB0aGlzLl9tYXhSZXNwb25zZVRva2VucztcbiAgICBsZXQgeyBwYXJlbnRNZXNzYWdlSWQgfSA9IG9wdHM7XG4gICAgbGV0IG5leHRQcm9tcHRCb2R5ID0gYCR7dGhpcy5fdXNlckxhYmVsfTpcXG5cXG4ke21lc3NhZ2V9JHt0aGlzLl9lbmRUb2tlbn1gO1xuICAgIGxldCBwcm9tcHRCb2R5ID0gXCJcIjtcbiAgICBsZXQgcHJvbXB0OiBzdHJpbmc7XG4gICAgbGV0IG51bVRva2VuczogbnVtYmVyO1xuXG4gICAgZG8ge1xuICAgICAgY29uc3QgbmV4dFByb21wdCA9IGAke3Byb21wdFByZWZpeH0ke25leHRQcm9tcHRCb2R5fSR7cHJvbXB0U3VmZml4fWA7XG4gICAgICBjb25zdCBuZXh0TnVtVG9rZW5zID0gYXdhaXQgdGhpcy5fZ2V0VG9rZW5Db3VudChuZXh0UHJvbXB0KTtcbiAgICAgIGNvbnN0IGlzVmFsaWRQcm9tcHQgPSBuZXh0TnVtVG9rZW5zIDw9IG1heE51bVRva2VucztcblxuICAgICAgaWYgKHByb21wdCAmJiAhaXNWYWxpZFByb21wdCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgcHJvbXB0Qm9keSA9IG5leHRQcm9tcHRCb2R5O1xuICAgICAgcHJvbXB0ID0gbmV4dFByb21wdDtcbiAgICAgIG51bVRva2VucyA9IG5leHROdW1Ub2tlbnM7XG5cbiAgICAgIGlmICghaXNWYWxpZFByb21wdCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgaWYgKCFwYXJlbnRNZXNzYWdlSWQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhcmVudE1lc3NhZ2UgPSBhd2FpdCB0aGlzLl9nZXRNZXNzYWdlQnlJZChwYXJlbnRNZXNzYWdlSWQpO1xuICAgICAgaWYgKCFwYXJlbnRNZXNzYWdlKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJlbnRNZXNzYWdlUm9sZSA9IHBhcmVudE1lc3NhZ2Uucm9sZSB8fCBcInVzZXJcIjtcbiAgICAgIGNvbnN0IHBhcmVudE1lc3NhZ2VSb2xlRGVzYyA9XG4gICAgICAgIHBhcmVudE1lc3NhZ2VSb2xlID09PSBcInVzZXJcIiA/IHRoaXMuX3VzZXJMYWJlbCA6IHRoaXMuX2Fzc2lzdGFudExhYmVsO1xuXG4gICAgICAvLyBUT0RPOiBkaWZmZXJlbnRpYXRlIGJldHdlZW4gYXNzaXN0YW50IGFuZCB1c2VyIG1lc3NhZ2VzXG4gICAgICBjb25zdCBwYXJlbnRNZXNzYWdlU3RyaW5nID0gYCR7cGFyZW50TWVzc2FnZVJvbGVEZXNjfTpcXG5cXG4ke3BhcmVudE1lc3NhZ2UudGV4dH0ke3RoaXMuX2VuZFRva2VufVxcblxcbmA7XG4gICAgICBuZXh0UHJvbXB0Qm9keSA9IGAke3BhcmVudE1lc3NhZ2VTdHJpbmd9JHtwcm9tcHRCb2R5fWA7XG4gICAgICBwYXJlbnRNZXNzYWdlSWQgPSBwYXJlbnRNZXNzYWdlLnBhcmVudE1lc3NhZ2VJZDtcbiAgICB9IHdoaWxlICh0cnVlKTtcblxuICAgIC8vIFVzZSB1cCB0byA0MDk2IHRva2VucyAocHJvbXB0ICsgcmVzcG9uc2UpLCBidXQgdHJ5IHRvIGxlYXZlIDEwMDAgdG9rZW5zXG4gICAgLy8gZm9yIHRoZSByZXNwb25zZS5cbiAgICBjb25zdCBtYXhUb2tlbnMgPSBNYXRoLm1heChcbiAgICAgIDEsXG4gICAgICBNYXRoLm1pbih0aGlzLl9tYXhNb2RlbFRva2VucyAtIG51bVRva2VucywgdGhpcy5fbWF4UmVzcG9uc2VUb2tlbnMpXG4gICAgKTtcbiAgICByZXR1cm4geyBwcm9tcHQsIG1heFRva2VucyB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIF9nZXRUb2tlbkNvdW50KHRleHQ6IHN0cmluZykge1xuICAgIGlmICh0aGlzLl9pc0NoYXRHUFRNb2RlbCkge1xuICAgICAgLy8gV2l0aCB0aGlzIG1vZGVsLCBcIjx8aW1fZW5kfD5cIiBpcyAxIHRva2VuLCBidXQgdG9rZW5pemVycyBhcmVuJ3QgYXdhcmUgb2YgaXQgeWV0LlxuICAgICAgLy8gUmVwbGFjZSBpdCB3aXRoIFwiPHxlbmRvZnRleHR8PlwiICh3aGljaCBpdCBkb2VzIGtub3cgYWJvdXQpIHNvIHRoYXQgdGhlIHRva2VuaXplciBjYW4gY291bnQgaXQgYXMgMSB0b2tlbi5cbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoLzxcXHxpbV9lbmRcXHw+L2csIFwiPHxlbmRvZnRleHR8PlwiKTtcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoLzxcXHxpbV9zZXBcXHw+L2csIFwiPHxlbmRvZnRleHR8PlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZ3B0RW5jb2RlKHRleHQpLmxlbmd0aDtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXQgX2lzQ2hhdEdQVE1vZGVsKCkge1xuICAgIHJldHVybiAoXG4gICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLm1vZGVsLnN0YXJ0c1dpdGgoXCJ0ZXh0LWNoYXRcIikgfHxcbiAgICAgIHRoaXMuX2NvbXBsZXRpb25QYXJhbXMubW9kZWwuc3RhcnRzV2l0aChcInRleHQtZGF2aW5jaS0wMDItcmVuZGVyXCIpIHx8XG4gICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLm1vZGVsLnN0YXJ0c1dpdGgoXCJncHQtXCIpXG4gICAgKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBfZGVmYXVsdEdldE1lc3NhZ2VCeUlkKFxuICAgIGlkOiBzdHJpbmdcbiAgKTogUHJvbWlzZTx0eXBlcy5DaGF0TWVzc2FnZT4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMuX21lc3NhZ2VTdG9yZS5nZXQoaWQpO1xuICAgIGNvbnNvbGUubG9nKFwiZ2V0TWVzc2FnZUJ5SWRcIiwgaWQsIHJlcyk7XG4gICAgcmV0dXJuIHJlcztcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBfZGVmYXVsdFVwc2VydE1lc3NhZ2UoXG4gICAgbWVzc2FnZTogdHlwZXMuQ2hhdE1lc3NhZ2VcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc29sZS5sb2coXCI9PT51cHNlcnRNZXNzYWdlPlwiLCBtZXNzYWdlLmlkLCBtZXNzYWdlKTtcbiAgICBhd2FpdCB0aGlzLl9tZXNzYWdlU3RvcmUuc2V0KG1lc3NhZ2UuaWQsIG1lc3NhZ2UpO1xuICB9XG59XG4iXX0=