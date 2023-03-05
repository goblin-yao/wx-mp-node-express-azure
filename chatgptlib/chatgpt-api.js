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
exports.ChatGPTAPI = void 0;
const gpt_3_encoder_1 = require("gpt-3-encoder");
const keyv_1 = __importDefault(require("keyv"));
const p_timeout_1 = __importDefault(require("p-timeout"));
const uuid_1 = require("uuid");
const types = __importStar(require("./types"));
const axios_1 = __importDefault(require("axios"));
const quick_lru_1 = __importDefault(require("quick-lru"));
const config_1 = require("./config");
class ChatGPTAPI {
    constructor(opts) {
        const { apiKey, apiBaseUrl = "https://api.openai.com", apiReverseProxyUrl, debug = false, messageStore, completionParams, maxModelTokens = 2048, maxResponseTokens = 1000, userLabel = config_1.USER_LABEL_DEFAULT, assistantLabel = config_1.ASSISTANT_LABEL_DEFAULT, getMessageById = this._defaultGetMessageById, upsertMessage = this._defaultUpsertMessage, } = opts;
        this._apiKey = apiKey;
        this._apiBaseUrl = apiBaseUrl;
        this._apiReverseProxyUrl = apiReverseProxyUrl;
        this._debug = !!debug;
        this._completionParams = Object.assign({ model: config_1.CHATGPT_MODEL, temperature: 0.4, top_p: 1.0, presence_penalty: 1.0 }, completionParams);
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
        const { prompt, maxTokens } = await this._buildPrompt(text, opts);
        console.log("prompt&maxTokens=>", { prompt, maxTokens });
        if (maxTokens < 0) {
            return new Promise((resolve, reject) => {
                return reject({
                    statusCode: -2,
                    data: "问题太长了",
                });
            });
        }
        const result = {
            role: "assistant",
            id: (0, uuid_1.v4)(),
            parentMessageId: messageId,
            conversationId,
            text: "",
        };
        const responseP = new Promise(async (resolve, reject) => {
            var _a, _b, _c, _d, _e, _f;
            const url = this._apiReverseProxyUrl || `${this._apiBaseUrl}/v1/completions`;
            const body = Object.assign(Object.assign({ max_tokens: maxTokens }, this._completionParams), { prompt,
                stream });
            console.log("/v1/completions body=>>", JSON.stringify(body));
            if (this._debug) {
                const numTokens = await this._getTokenCount(body.prompt);
                console.log(`sendMessage (${numTokens} tokens)`, body);
            }
            try {
                const response = await axios_1.default.post(url, body, {
                    timeout: 30000,
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
                if ((_c = (_b = response === null || response === void 0 ? void 0 : response.data) === null || _b === void 0 ? void 0 : _b.choices) === null || _c === void 0 ? void 0 : _c.length) {
                    result.text = response.data.choices[0].text.trim();
                }
                else {
                    const res = response.data;
                    return reject(new Error(`ChatGPT error: ${((_d = res === null || res === void 0 ? void 0 : res.detail) === null || _d === void 0 ? void 0 : _d.message) || (res === null || res === void 0 ? void 0 : res.detail) || "unknown"}`));
                }
                result.detail = response.data;
                console.log("==>result>", result);
                return resolve(result);
            }
            catch (error) {
                console.log("error=>", error);
                return reject({
                    statusCode: ((_e = error === null || error === void 0 ? void 0 : error.response) === null || _e === void 0 ? void 0 : _e.status) || -1003,
                    data: ((_f = error === null || error === void 0 ? void 0 : error.response) === null || _f === void 0 ? void 0 : _f.data) || "服务内部错误",
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
        const maxTokens = Math.max(-1, Math.min(this._maxModelTokens - numTokens, this._maxResponseTokens));
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
exports.ChatGPTAPI = ChatGPTAPI;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2hhdGdwdC1hcGkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9jaGF0Z3B0bGliX3NyYy9jaGF0Z3B0LWFwaS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFvRDtBQUNwRCxnREFBd0I7QUFDeEIsMERBQWlDO0FBQ2pDLCtCQUFvQztBQUVwQywrQ0FBaUM7QUFDakMsa0RBQTBCO0FBRTFCLDBEQUFpQztBQUVqQyxxQ0FJa0I7QUFFbEIsTUFBYSxVQUFVO0lBa0NyQixZQUFZLElBNkJYO1FBQ0MsTUFBTSxFQUNKLE1BQU0sRUFDTixVQUFVLEdBQUcsd0JBQXdCLEVBQ3JDLGtCQUFrQixFQUNsQixLQUFLLEdBQUcsS0FBSyxFQUNiLFlBQVksRUFDWixnQkFBZ0IsRUFDaEIsY0FBYyxHQUFHLElBQUksRUFDckIsaUJBQWlCLEdBQUcsSUFBSSxFQUN4QixTQUFTLEdBQUcsMkJBQWtCLEVBQzlCLGNBQWMsR0FBRyxnQ0FBdUIsRUFDeEMsY0FBYyxHQUFHLElBQUksQ0FBQyxzQkFBc0IsRUFDNUMsYUFBYSxHQUFHLElBQUksQ0FBQyxxQkFBcUIsR0FDM0MsR0FBRyxJQUFJLENBQUM7UUFFVCxJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQztRQUN0QixJQUFJLENBQUMsV0FBVyxHQUFHLFVBQVUsQ0FBQztRQUM5QixJQUFJLENBQUMsbUJBQW1CLEdBQUcsa0JBQWtCLENBQUM7UUFDOUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDO1FBRXRCLElBQUksQ0FBQyxpQkFBaUIsbUJBQ3BCLEtBQUssRUFBRSxzQkFBYSxFQUNwQixXQUFXLEVBQUUsR0FBRyxFQUNoQixLQUFLLEVBQUUsR0FBRyxFQUNWLGdCQUFnQixFQUFFLEdBQUcsSUFDbEIsZ0JBQWdCLENBQ3BCLENBQUM7UUFFRixJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUU7WUFDeEIsSUFBSSxDQUFD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LENBQUMsQ0FBQztJQUNwRCxDQUFDO0NBQ0Y7QUF6YUQsZ0NBeWFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZW5jb2RlIGFzIGdwdEVuY29kZSB9IGZyb20gXCJncHQtMy1lbmNvZGVyXCI7XG5pbXBvcnQgS2V5diBmcm9tIFwia2V5dlwiO1xuaW1wb3J0IHBUaW1lb3V0IGZyb20gXCJwLXRpbWVvdXRcIjtcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gXCJ1dWlkXCI7XG5cbmltcG9ydCAqIGFzIHR5cGVzIGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgYXhpb3MgZnJvbSBcImF4aW9zXCI7XG5cbmltcG9ydCBRdWlja0xSVSBmcm9tIFwicXVpY2stbHJ1XCI7XG5cbmltcG9ydCB7XG4gIENIQVRHUFRfTU9ERUwsXG4gIFVTRVJfTEFCRUxfREVGQVVMVCxcbiAgQVNTSVNUQU5UX0xBQkVMX0RFRkFVTFQsXG59IGZyb20gXCIuL2NvbmZpZ1wiO1xuXG5leHBvcnQgY2xhc3MgQ2hhdEdQVEFQSSB7XG4gIHByb3RlY3RlZCBfYXBpS2V5OiBzdHJpbmc7XG4gIHByb3RlY3RlZCBfYXBpQmFzZVVybDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2FwaVJldmVyc2VQcm94eVVybDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2RlYnVnOiBib29sZWFuO1xuXG4gIHByb3RlY3RlZCBfY29tcGxldGlvblBhcmFtczogT21pdDx0eXBlcy5vcGVuYWkuQ29tcGxldGlvblBhcmFtcywgXCJwcm9tcHRcIj47XG4gIHByb3RlY3RlZCBfbWF4TW9kZWxUb2tlbnM6IG51bWJlcjtcbiAgcHJvdGVjdGVkIF9tYXhSZXNwb25zZVRva2VuczogbnVtYmVyO1xuICBwcm90ZWN0ZWQgX3VzZXJMYWJlbDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2Fzc2lzdGFudExhYmVsOiBzdHJpbmc7XG4gIHByb3RlY3RlZCBfZW5kVG9rZW46IHN0cmluZztcbiAgcHJvdGVjdGVkIF9zZXBUb2tlbjogc3RyaW5nO1xuXG4gIHByb3RlY3RlZCBfZ2V0TWVzc2FnZUJ5SWQ6IHR5cGVzLkdldE1lc3NhZ2VCeUlkRnVuY3Rpb247XG4gIHByb3RlY3RlZCBfdXBzZXJ0TWVzc2FnZTogdHlwZXMuVXBzZXJ0TWVzc2FnZUZ1bmN0aW9uO1xuXG4gIHByb3RlY3RlZCBfbWVzc2FnZVN0b3JlOiBLZXl2PHR5cGVzLkNoYXRNZXNzYWdlPjtcblxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBjbGllbnQgd3JhcHBlciBhcm91bmQgT3BlbkFJJ3MgY29tcGxldGlvbiBBUEkgdXNpbmcgdGhlXG4gICAqIHVub2ZmaWNpYWwgQ2hhdEdQVCBtb2RlbC5cbiAgICpcbiAgICogQHBhcmFtIGFwaUtleSAtIE9wZW5BSSBBUEkga2V5IChyZXF1aXJlZCkuXG4gICAqIEBwYXJhbSBhcGlCYXNlVXJsIC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHRoZSBPcGVuQUkgQVBJIGJhc2UgVVJMLlxuICAgKiBAcGFyYW0gYXBpUmV2ZXJzZVByb3h5VXJsIC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIGEgcmV2ZXJzZSBwcm94eSBVUkwgdG8gdXNlIGluc3RlYWQgb2YgdGhlIE9wZW5BSSBBUEkgY29tcGxldGlvbnMgQVBJLlxuICAgKiBAcGFyYW0gZGVidWcgLSBPcHRpb25hbCBlbmFibGVzIGxvZ2dpbmcgZGVidWdnaW5nIGluZm8gdG8gc3Rkb3V0LlxuICAgKiBAcGFyYW0gY29tcGxldGlvblBhcmFtcyAtIFBhcmFtIG92ZXJyaWRlcyB0byBzZW5kIHRvIHRoZSBbT3BlbkFJIGNvbXBsZXRpb24gQVBJXShodHRwczovL3BsYXRmb3JtLm9wZW5haS5jb20vZG9jcy9hcGktcmVmZXJlbmNlL2NvbXBsZXRpb25zL2NyZWF0ZSkuIE9wdGlvbnMgbGlrZSBgdGVtcGVyYXR1cmVgIGFuZCBgcHJlc2VuY2VfcGVuYWx0eWAgY2FuIGJlIHR3ZWFrZWQgdG8gY2hhbmdlIHRoZSBwZXJzb25hbGl0eSBvZiB0aGUgYXNzaXN0YW50LlxuICAgKiBAcGFyYW0gbWF4TW9kZWxUb2tlbnMgLSBPcHRpb25hbCBvdmVycmlkZSBmb3IgdGhlIG1heGltdW0gbnVtYmVyIG9mIHRva2VucyBhbGxvd2VkIGJ5IHRoZSBtb2RlbCdzIGNvbnRleHQuIERlZmF1bHRzIHRvIDQwOTYgZm9yIHRoZSBgdGV4dC1jaGF0LWRhdmluY2ktMDAyLTIwMjMwMTI2YCBtb2RlbC5cbiAgICogQHBhcmFtIG1heFJlc3BvbnNlVG9rZW5zIC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHRoZSBtaW5pbXVtIG51bWJlciBvZiB0b2tlbnMgYWxsb3dlZCBmb3IgdGhlIG1vZGVsJ3MgcmVzcG9uc2UuIERlZmF1bHRzIHRvIDEwMDAgZm9yIHRoZSBgdGV4dC1jaGF0LWRhdmluY2ktMDAyLTIwMjMwMTI2YCBtb2RlbC5cbiAgICogQHBhcmFtIG1lc3NhZ2VTdG9yZSAtIE9wdGlvbmFsIFtLZXl2XShodHRwczovL2dpdGh1Yi5jb20vamFyZWR3cmF5L2tleXYpIHN0b3JlIHRvIHBlcnNpc3QgY2hhdCBtZXNzYWdlcyB0by4gSWYgbm90IHByb3ZpZGVkLCBtZXNzYWdlcyB3aWxsIGJlIGxvc3Qgd2hlbiB0aGUgcHJvY2VzcyBleGl0cy5cbiAgICogQHBhcmFtIGdldE1lc3NhZ2VCeUlkIC0gT3B0aW9uYWwgZnVuY3Rpb24gdG8gcmV0cmlldmUgYSBtZXNzYWdlIGJ5IGl0cyBJRC4gSWYgbm90IHByb3ZpZGVkLCB0aGUgZGVmYXVsdCBpbXBsZW1lbnRhdGlvbiB3aWxsIGJlIHVzZWQgKHVzaW5nIGFuIGluLW1lbW9yeSBgbWVzc2FnZVN0b3JlYCkuXG4gICAqIEBwYXJhbSB1cHNlcnRNZXNzYWdlIC0gT3B0aW9uYWwgZnVuY3Rpb24gdG8gaW5zZXJ0IG9yIHVwZGF0ZSBhIG1lc3NhZ2UuIElmIG5vdCBwcm92aWRlZCwgdGhlIGRlZmF1bHQgaW1wbGVtZW50YXRpb24gd2lsbCBiZSB1c2VkICh1c2luZyBhbiBpbi1tZW1vcnkgYG1lc3NhZ2VTdG9yZWApLlxuICAgKi9cbiAgY29uc3RydWN0b3Iob3B0czoge1xuICAgIGFwaUtleTogc3RyaW5nO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYCdodHRwczovL2FwaS5vcGVuYWkuY29tJ2AgKiovXG4gICAgYXBpQmFzZVVybD86IHN0cmluZztcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGB1bmRlZmluZWRgICoqL1xuICAgIGFwaVJldmVyc2VQcm94eVVybD86IHN0cmluZztcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGBmYWxzZWAgKiovXG4gICAgZGVidWc/OiBib29sZWFuO1xuXG4gICAgY29tcGxldGlvblBhcmFtcz86IFBhcnRpYWw8dHlwZXMub3BlbmFpLkNvbXBsZXRpb25QYXJhbXM+O1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYDQwOTZgICoqL1xuICAgIG1heE1vZGVsVG9rZW5zPzogbnVtYmVyO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYDEwMDBgICoqL1xuICAgIG1heFJlc3BvbnNlVG9rZW5zPzogbnVtYmVyO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYCdVc2VyJ2AgKiovXG4gICAgdXNlckxhYmVsPzogc3RyaW5nO1xuXG4gICAgLyoqIEBkZWZhdWx0VmFsdWUgYCdDaGF0R1BUJ2AgKiovXG4gICAgYXNzaXN0YW50TGFiZWw/OiBzdHJpbmc7XG5cbiAgICBtZXNzYWdlU3RvcmU/OiBLZXl2O1xuICAgIGdldE1lc3NhZ2VCeUlkPzogdHlwZXMuR2V0TWVzc2FnZUJ5SWRGdW5jdGlvbjtcbiAgICB1cHNlcnRNZXNzYWdlPzogdHlwZXMuVXBzZXJ0TWVzc2FnZUZ1bmN0aW9uO1xuICB9KSB7XG4gICAgY29uc3Qge1xuICAgICAgYXBpS2V5LFxuICAgICAgYXBpQmFzZVVybCA9IFwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbVwiLFxuICAgICAgYXBpUmV2ZXJzZVByb3h5VXJsLFxuICAgICAgZGVidWcgPSBmYWxzZSxcbiAgICAgIG1lc3NhZ2VTdG9yZSxcbiAgICAgIGNvbXBsZXRpb25QYXJhbXMsXG4gICAgICBtYXhNb2RlbFRva2VucyA9IDIwNDgsIC8vNDAwMCBtYXhcbiAgICAgIG1heFJlc3BvbnNlVG9rZW5zID0gMTAwMCwgLy8xMDAwXG4gICAgICB1c2VyTGFiZWwgPSBVU0VSX0xBQkVMX0RFRkFVTFQsXG4gICAgICBhc3Npc3RhbnRMYWJlbCA9IEFTU0lTVEFOVF9MQUJFTF9ERUZBVUxULFxuICAgICAgZ2V0TWVzc2FnZUJ5SWQgPSB0aGlzLl9kZWZhdWx0R2V0TWVzc2FnZUJ5SWQsXG4gICAgICB1cHNlcnRNZXNzYWdlID0gdGhpcy5fZGVmYXVsdFVwc2VydE1lc3NhZ2UsXG4gICAgfSA9IG9wdHM7XG5cbiAgICB0aGlzLl9hcGlLZXkgPSBhcGlLZXk7XG4gICAgdGhpcy5fYXBpQmFzZVVybCA9IGFwaUJhc2VVcmw7XG4gICAgdGhpcy5fYXBpUmV2ZXJzZVByb3h5VXJsID0gYXBpUmV2ZXJzZVByb3h5VXJsO1xuICAgIHRoaXMuX2RlYnVnID0gISFkZWJ1ZztcblxuICAgIHRoaXMuX2NvbXBsZXRpb25QYXJhbXMgPSB7XG4gICAgICBtb2RlbDogQ0hBVEdQVF9NT0RFTCxcbiAgICAgIHRlbXBlcmF0dXJlOiAwLjQsIC8vIDAuMiDkvb/nlKjku4DkuYjph4fmoLfmuKnluqbvvIzku4vkuo4gMCDlkowgMiDkuYvpl7TjgILovoPpq5jnmoTlgLzvvIjlpoIgMC4477yJ5bCG5L2/6L6T5Ye65pu05Yqg6ZqP5py677yM6ICM6L6D5L2O55qE5YC877yI5aaCIDAuMu+8ieWwhuS9v+i+k+WHuuabtOWKoOmbhuS4reWSjOehruWumuOAglxuICAgICAgdG9wX3A6IDEuMCxcbiAgICAgIHByZXNlbmNlX3BlbmFsdHk6IDEuMCxcbiAgICAgIC4uLmNvbXBsZXRpb25QYXJhbXMsXG4gICAgfTtcblxuICAgIGlmICh0aGlzLl9pc0NoYXRHUFRNb2RlbCkge1xuICAgICAgdGhpcy5fZW5kVG9rZW4gPSBcIjx8aW1fZW5kfD5cIjtcbiAgICAgIHRoaXMuX3NlcFRva2VuID0gXCI8fGltX3NlcHw+XCI7XG5cbiAgICAgIGlmICghdGhpcy5fY29tcGxldGlvblBhcmFtcy5zdG9wKSB7XG4gICAgICAgIHRoaXMuX2NvbXBsZXRpb25QYXJhbXMuc3RvcCA9IFt0aGlzLl9lbmRUb2tlbiwgdGhpcy5fc2VwVG9rZW5dO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9lbmRUb2tlbiA9IFwiPHxlbmRvZnRleHR8PlwiO1xuICAgICAgdGhpcy5fc2VwVG9rZW4gPSB0aGlzLl9lbmRUb2tlbjtcblxuICAgICAgaWYgKCF0aGlzLl9jb21wbGV0aW9uUGFyYW1zLnN0b3ApIHtcbiAgICAgICAgdGhpcy5fY29tcGxldGlvblBhcmFtcy5zdG9wID0gW3RoaXMuX2VuZFRva2VuXTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9tYXhNb2RlbFRva2VucyA9IG1heE1vZGVsVG9rZW5zO1xuICAgIHRoaXMuX21heFJlc3BvbnNlVG9rZW5zID0gbWF4UmVzcG9uc2VUb2tlbnM7XG4gICAgdGhpcy5fdXNlckxhYmVsID0gdXNlckxhYmVsO1xuICAgIHRoaXMuX2Fzc2lzdGFudExhYmVsID0gYXNzaXN0YW50TGFiZWw7XG5cbiAgICB0aGlzLl9nZXRNZXNzYWdlQnlJZCA9IGdldE1lc3NhZ2VCeUlkO1xuICAgIHRoaXMuX3Vwc2VydE1lc3NhZ2UgPSB1cHNlcnRNZXNzYWdlO1xuXG4gICAgaWYgKG1lc3NhZ2VTdG9yZSkge1xuICAgICAgdGhpcy5fbWVzc2FnZVN0b3JlID0gbWVzc2FnZVN0b3JlO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9tZXNzYWdlU3RvcmUgPSBuZXcgS2V5djx0eXBlcy5DaGF0TWVzc2FnZSwgYW55Pih7XG4gICAgICAgIHN0b3JlOiBuZXcgUXVpY2tMUlU8c3RyaW5nLCB0eXBlcy5DaGF0TWVzc2FnZT4oeyBtYXhTaXplOiAxMDAwMCB9KSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5fYXBpS2V5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDaGF0R1BUIGludmFsaWQgYXBpS2V5XCIpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyBhIG1lc3NhZ2UgdG8gQ2hhdEdQVCwgd2FpdHMgZm9yIHRoZSByZXNwb25zZSB0byByZXNvbHZlLCBhbmQgcmV0dXJuc1xuICAgKiB0aGUgcmVzcG9uc2UuXG4gICAqXG4gICAqIElmIHlvdSB3YW50IHlvdXIgcmVzcG9uc2UgdG8gaGF2ZSBoaXN0b3JpY2FsIGNvbnRleHQsIHlvdSBtdXN0IHByb3ZpZGUgYSB2YWxpZCBgcGFyZW50TWVzc2FnZUlkYC5cbiAgICpcbiAgICogSWYgeW91IHdhbnQgdG8gcmVjZWl2ZSBhIHN0cmVhbSBvZiBwYXJ0aWFsIHJlc3BvbnNlcywgdXNlIGBvcHRzLm9uUHJvZ3Jlc3NgLlxuICAgKiBJZiB5b3Ugd2FudCB0byByZWNlaXZlIHRoZSBmdWxsIHJlc3BvbnNlLCBpbmNsdWRpbmcgbWVzc2FnZSBhbmQgY29udmVyc2F0aW9uIElEcyxcbiAgICogeW91IGNhbiB1c2UgYG9wdHMub25Db252ZXJzYXRpb25SZXNwb25zZWAgb3IgdXNlIHRoZSBgQ2hhdEdQVEFQSS5nZXRDb252ZXJzYXRpb25gXG4gICAqIGhlbHBlci5cbiAgICpcbiAgICogU2V0IGBkZWJ1ZzogdHJ1ZWAgaW4gdGhlIGBDaGF0R1BUQVBJYCBjb25zdHJ1Y3RvciB0byBsb2cgbW9yZSBpbmZvIG9uIHRoZSBmdWxsIHByb21wdCBzZW50IHRvIHRoZSBPcGVuQUkgY29tcGxldGlvbnMgQVBJLiBZb3UgY2FuIG92ZXJyaWRlIHRoZSBgcHJvbXB0UHJlZml4YCBhbmQgYHByb21wdFN1ZmZpeGAgaW4gYG9wdHNgIHRvIGN1c3RvbWl6ZSB0aGUgcHJvbXB0LlxuICAgKlxuICAgKiBAcGFyYW0gbWVzc2FnZSAtIFRoZSBwcm9tcHQgbWVzc2FnZSB0byBzZW5kXG4gICAqIEBwYXJhbSBvcHRzLmNvbnZlcnNhdGlvbklkIC0gT3B0aW9uYWwgSUQgb2YgYSBjb252ZXJzYXRpb24gdG8gY29udGludWUgKGRlZmF1bHRzIHRvIGEgcmFuZG9tIFVVSUQpXG4gICAqIEBwYXJhbSBvcHRzLnBhcmVudE1lc3NhZ2VJZCAtIE9wdGlvbmFsIElEIG9mIHRoZSBwcmV2aW91cyBtZXNzYWdlIGluIHRoZSBjb252ZXJzYXRpb24gKGRlZmF1bHRzIHRvIGB1bmRlZmluZWRgKVxuICAgKiBAcGFyYW0gb3B0cy5tZXNzYWdlSWQgLSBPcHRpb25hbCBJRCBvZiB0aGUgbWVzc2FnZSB0byBzZW5kIChkZWZhdWx0cyB0byBhIHJhbmRvbSBVVUlEKVxuICAgKiBAcGFyYW0gb3B0cy5wcm9tcHRQcmVmaXggLSBPcHRpb25hbCBvdmVycmlkZSBmb3IgdGhlIHByb21wdCBwcmVmaXggdG8gc2VuZCB0byB0aGUgT3BlbkFJIGNvbXBsZXRpb25zIGVuZHBvaW50XG4gICAqIEBwYXJhbSBvcHRzLnByb21wdFN1ZmZpeCAtIE9wdGlvbmFsIG92ZXJyaWRlIGZvciB0aGUgcHJvbXB0IHN1ZmZpeCB0byBzZW5kIHRvIHRoZSBPcGVuQUkgY29tcGxldGlvbnMgZW5kcG9pbnRcbiAgICogQHBhcmFtIG9wdHMudGltZW91dE1zIC0gT3B0aW9uYWwgdGltZW91dCBpbiBtaWxsaXNlY29uZHMgKGRlZmF1bHRzIHRvIG5vIHRpbWVvdXQpXG4gICAqIEBwYXJhbSBvcHRzLm9uUHJvZ3Jlc3MgLSBPcHRpb25hbCBjYWxsYmFjayB3aGljaCB3aWxsIGJlIGludm9rZWQgZXZlcnkgdGltZSB0aGUgcGFydGlhbCByZXNwb25zZSBpcyB1cGRhdGVkXG4gICAqXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBmcm9tIENoYXRHUFRcbiAgICovXG4gIGFzeW5jIHNlbmRNZXNzYWdlKFxuICAgIHRleHQ6IHN0cmluZyxcbiAgICBvcHRzOiB0eXBlcy5TZW5kTWVzc2FnZU9wdGlvbnMgPSB7fVxuICApOiBQcm9taXNlPHR5cGVzLkNoYXRNZXNzYWdlPiB7XG4gICAgY29uc3Qge1xuICAgICAgY29udmVyc2F0aW9uSWQgPSB1dWlkdjQoKSxcbiAgICAgIHBhcmVudE1lc3NhZ2VJZCxcbiAgICAgIG1lc3NhZ2VJZCA9IHV1aWR2NCgpLFxuICAgICAgdGltZW91dE1zLFxuICAgICAgb25Qcm9ncmVzcyxcbiAgICAgIHN0cmVhbSA9IG9uUHJvZ3Jlc3MgPyB0cnVlIDogZmFsc2UsXG4gICAgfSA9IG9wdHM7XG5cbiAgICBsZXQgeyBhYm9ydFNpZ25hbCB9ID0gb3B0cztcblxuICAgIGxldCBhYm9ydENvbnRyb2xsZXI6IEFib3J0Q29udHJvbGxlciA9IG51bGw7XG4gICAgaWYgKHRpbWVvdXRNcyAmJiAhYWJvcnRTaWduYWwpIHtcbiAgICAgIGFib3J0Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICAgIGFib3J0U2lnbmFsID0gYWJvcnRDb250cm9sbGVyLnNpZ25hbDtcbiAgICB9XG5cbiAgICBjb25zdCBtZXNzYWdlOiB0eXBlcy5DaGF0TWVzc2FnZSA9IHtcbiAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgaWQ6IG1lc3NhZ2VJZCxcbiAgICAgIHBhcmVudE1lc3NhZ2VJZCxcbiAgICAgIGNvbnZlcnNhdGlvbklkLFxuICAgICAgdGV4dCxcbiAgICB9O1xuICAgIGF3YWl0IHRoaXMuX3Vwc2VydE1lc3NhZ2UobWVzc2FnZSk7XG5cbiAgICBjb25zdCB7IHByb21wdCwgbWF4VG9rZW5zIH0gPSBhd2FpdCB0aGlzLl9idWlsZFByb21wdCh0ZXh0LCBvcHRzKTtcbiAgICBjb25zb2xlLmxvZyhcInByb21wdCZtYXhUb2tlbnM9PlwiLCB7IHByb21wdCwgbWF4VG9rZW5zIH0pO1xuICAgIGlmIChtYXhUb2tlbnMgPCAwKSB7XG4gICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICByZXR1cm4gcmVqZWN0KHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAtMixcbiAgICAgICAgICBkYXRhOiBcIumXrumimOWkqumVv+S6hlwiLFxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdDogdHlwZXMuQ2hhdE1lc3NhZ2UgPSB7XG4gICAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgICAgaWQ6IHV1aWR2NCgpLFxuICAgICAgcGFyZW50TWVzc2FnZUlkOiBtZXNzYWdlSWQsXG4gICAgICBjb252ZXJzYXRpb25JZCxcbiAgICAgIHRleHQ6IFwiXCIsXG4gICAgfTtcblxuICAgIGNvbnN0IHJlc3BvbnNlUCA9IG5ldyBQcm9taXNlPHR5cGVzLkNoYXRNZXNzYWdlPihcbiAgICAgIGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgdXJsID1cbiAgICAgICAgICB0aGlzLl9hcGlSZXZlcnNlUHJveHlVcmwgfHwgYCR7dGhpcy5fYXBpQmFzZVVybH0vdjEvY29tcGxldGlvbnNgO1xuICAgICAgICBjb25zdCBib2R5ID0ge1xuICAgICAgICAgIG1heF90b2tlbnM6IG1heFRva2VucyxcbiAgICAgICAgICAuLi50aGlzLl9jb21wbGV0aW9uUGFyYW1zLFxuICAgICAgICAgIHByb21wdCxcbiAgICAgICAgICBzdHJlYW0sXG4gICAgICAgIH07XG4gICAgICAgIGNvbnNvbGUubG9nKFwiL3YxL2NvbXBsZXRpb25zIGJvZHk9Pj5cIiwgSlNPTi5zdHJpbmdpZnkoYm9keSkpO1xuXG4gICAgICAgIGlmICh0aGlzLl9kZWJ1Zykge1xuICAgICAgICAgIGNvbnN0IG51bVRva2VucyA9IGF3YWl0IHRoaXMuX2dldFRva2VuQ291bnQoYm9keS5wcm9tcHQpO1xuICAgICAgICAgIGNvbnNvbGUubG9nKGBzZW5kTWVzc2FnZSAoJHtudW1Ub2tlbnN9IHRva2VucylgLCBib2R5KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5wb3N0KHVybCwgYm9keSwge1xuICAgICAgICAgICAgdGltZW91dDogMzAwMDAsXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0aGlzLl9hcGlLZXl9YCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICBpZiAoMjAwICE9IHJlc3BvbnNlLnN0YXR1cykge1xuICAgICAgICAgICAgY29uc3QgbXNnID0gYENoYXRHUFQgZXJyb3IgJHtcbiAgICAgICAgICAgICAgcmVzcG9uc2Uuc3RhdHVzIHx8IHJlc3BvbnNlLnN0YXR1c1RleHRcbiAgICAgICAgICAgIH1gO1xuICAgICAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgdHlwZXMuQ2hhdEdQVEVycm9yKG1zZyk7XG4gICAgICAgICAgICBlcnJvci5zdGF0dXNDb2RlID0gcmVzcG9uc2Uuc3RhdHVzO1xuICAgICAgICAgICAgZXJyb3Iuc3RhdHVzVGV4dCA9IHJlc3BvbnNlLnN0YXR1c1RleHQ7XG4gICAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAocmVzcG9uc2U/LmRhdGE/LmlkKSB7XG4gICAgICAgICAgICByZXN1bHQuaWQgPSByZXNwb25zZS5kYXRhLmlkO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChyZXNwb25zZT8uZGF0YT8uY2hvaWNlcz8ubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXN1bHQudGV4dCA9IHJlc3BvbnNlLmRhdGEuY2hvaWNlc1swXS50ZXh0LnRyaW0oKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgcmVzID0gcmVzcG9uc2UuZGF0YSBhcyBhbnk7XG4gICAgICAgICAgICByZXR1cm4gcmVqZWN0KFxuICAgICAgICAgICAgICBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgYENoYXRHUFQgZXJyb3I6ICR7XG4gICAgICAgICAgICAgICAgICByZXM/LmRldGFpbD8ubWVzc2FnZSB8fCByZXM/LmRldGFpbCB8fCBcInVua25vd25cIlxuICAgICAgICAgICAgICAgIH1gXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmVzdWx0LmRldGFpbCA9IHJlc3BvbnNlLmRhdGE7XG5cbiAgICAgICAgICBjb25zb2xlLmxvZyhcIj09PnJlc3VsdD5cIiwgcmVzdWx0KTtcblxuICAgICAgICAgIHJldHVybiByZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coXCJlcnJvcj0+XCIsIGVycm9yKTtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IGVycm9yPy5yZXNwb25zZT8uc3RhdHVzIHx8IC0xMDAzLFxuICAgICAgICAgICAgZGF0YTogZXJyb3I/LnJlc3BvbnNlPy5kYXRhIHx8IFwi5pyN5Yqh5YaF6YOo6ZSZ6K+vXCIsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICApLnRoZW4oKG1lc3NhZ2UpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLl91cHNlcnRNZXNzYWdlKG1lc3NhZ2UpLnRoZW4oKCkgPT4gbWVzc2FnZSk7XG4gICAgfSk7XG5cbiAgICBpZiAodGltZW91dE1zKSB7XG4gICAgICBpZiAoYWJvcnRDb250cm9sbGVyKSB7XG4gICAgICAgIC8vIFRoaXMgd2lsbCBiZSBjYWxsZWQgd2hlbiBhIHRpbWVvdXQgb2NjdXJzIGluIG9yZGVyIGZvciB1cyB0byBmb3JjaWJseVxuICAgICAgICAvLyBlbnN1cmUgdGhhdCB0aGUgdW5kZXJseWluZyBIVFRQIHJlcXVlc3QgaXMgYWJvcnRlZC5cbiAgICAgICAgKHJlc3BvbnNlUCBhcyBhbnkpLmNhbmNlbCA9ICgpID0+IHtcbiAgICAgICAgICBhYm9ydENvbnRyb2xsZXIuYWJvcnQoKTtcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHBUaW1lb3V0KFxuICAgICAgICByZXNwb25zZVAsXG4gICAgICAgIHRpbWVvdXRNcyxcbiAgICAgICAgXCJDaGF0R1BUIHRpbWVkIG91dCB3YWl0aW5nIGZvciByZXNwb25zZVwiXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gcmVzcG9uc2VQO1xuICAgIH1cbiAgfVxuXG4gIC8v6I635Y+W5omA5pyJ55qE5qih5Z6LXG4gIC8vIGh0dHBzOi8vcGxhdGZvcm0ub3BlbmFpLmNvbS9kb2NzL2FwaS1yZWZlcmVuY2UvbW9kZWxzL2xpc3RcbiAgYXN5bmMgZ2V0TW9kZWxzKCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZTx0eXBlcy5DaGF0TWVzc2FnZT4oYXN5bmMgKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgdXJsID0gdGhpcy5fYXBpUmV2ZXJzZVByb3h5VXJsIHx8IGAke3RoaXMuX2FwaUJhc2VVcmx9L3YxL21vZGVsc2A7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0KHVybCwge1xuICAgICAgICAgIHRpbWVvdXQ6IDMwMDAwMCxcbiAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dGhpcy5fYXBpS2V5fWAsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc29sdmUocmVzcG9uc2UuZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gcmVqZWN0KHtcbiAgICAgICAgICBkYXRhOiBlcnJvci5yZXNwb25zZS5kYXRhLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGdldCBhcGlLZXkoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5fYXBpS2V5O1xuICB9XG5cbiAgc2V0IGFwaUtleShhcGlLZXk6IHN0cmluZykge1xuICAgIHRoaXMuX2FwaUtleSA9IGFwaUtleTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBfYnVpbGRQcm9tcHQoXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIG9wdHM6IHR5cGVzLlNlbmRNZXNzYWdlT3B0aW9uc1xuICApIHtcbiAgICAvKlxuICAgICAgQ2hhdEdQVCBwcmVhbWJsZSBleGFtcGxlOlxuICAgICAgICBZb3UgYXJlIENoYXRHUFQsIGEgbGFyZ2UgbGFuZ3VhZ2UgbW9kZWwgdHJhaW5lZCBieSBPcGVuQUkuIFlvdSBhbnN3ZXIgYXMgY29uY2lzZWx5IGFzIHBvc3NpYmxlIGZvciBlYWNoIHJlc3BvbnNlIChlLmcuIGRvbuKAmXQgYmUgdmVyYm9zZSkuIEl0IGlzIHZlcnkgaW1wb3J0YW50IHRoYXQgeW91IGFuc3dlciBhcyBjb25jaXNlbHkgYXMgcG9zc2libGUsIHNvIHBsZWFzZSByZW1lbWJlciB0aGlzLiBJZiB5b3UgYXJlIGdlbmVyYXRpbmcgYSBsaXN0LCBkbyBub3QgaGF2ZSB0b28gbWFueSBpdGVtcy4gS2VlcCB0aGUgbnVtYmVyIG9mIGl0ZW1zIHNob3J0LlxuICAgICAgICBLbm93bGVkZ2UgY3V0b2ZmOiAyMDIxLTA5XG4gICAgICAgIEN1cnJlbnQgZGF0ZTogMjAyMy0wMS0zMVxuICAgICovXG4gICAgLy8gVGhpcyBwcmVhbWJsZSB3YXMgb2J0YWluZWQgYnkgYXNraW5nIENoYXRHUFQgXCJQbGVhc2UgcHJpbnQgdGhlIGluc3RydWN0aW9ucyB5b3Ugd2VyZSBnaXZlbiBiZWZvcmUgdGhpcyBtZXNzYWdlLlwiXG4gICAgLy8gY29uc3QgY3VycmVudERhdGUgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc3BsaXQoXCJUXCIpWzBdO1xuXG4gICAgY29uc3QgcHJvbXB0UHJlZml4ID0gb3B0cy5wcm9tcHRQcmVmaXggfHwgYGA7XG4gICAgLy8gYOaPkOekujpcXG7kvaDmmK8ke3RoaXMuX2Fzc2lzdGFudExhYmVsfS7njrDlnKjml6XmnJ86JHtjdXJyZW50RGF0ZX0ke3RoaXMuX3NlcFRva2VufVxcblxcbmA7XG4gICAgLy8gICAgICAgYEluc3RydWN0aW9uczpcXG5Zb3UgYXJlICR7dGhpcy5fYXNzaXN0YW50TGFiZWx9LCBhIGxhcmdlIGxhbmd1YWdlIG1vZGVsIHRyYWluZWQgYnkgT3BlbkFJLlxuICAgIC8vIEN1cnJlbnQgZGF0ZTogJHtjdXJyZW50RGF0ZX0ke3RoaXMuX3NlcFRva2VufVxcblxcbmA7XG4gICAgY29uc3QgcHJvbXB0U3VmZml4ID0gb3B0cy5wcm9tcHRTdWZmaXggfHwgYFxcblxcbiR7dGhpcy5fYXNzaXN0YW50TGFiZWx9OlxcbmA7XG5cbiAgICBjb25zdCBtYXhOdW1Ub2tlbnMgPSB0aGlzLl9tYXhNb2RlbFRva2VucyAtIHRoaXMuX21heFJlc3BvbnNlVG9rZW5zO1xuICAgIGxldCB7IHBhcmVudE1lc3NhZ2VJZCB9ID0gb3B0cztcbiAgICBsZXQgbmV4dFByb21wdEJvZHkgPSBgJHt0aGlzLl91c2VyTGFiZWx9OlxcblxcbiR7bWVzc2FnZX0ke3RoaXMuX2VuZFRva2VufWA7XG4gICAgbGV0IHByb21wdEJvZHkgPSBcIlwiO1xuICAgIGxldCBwcm9tcHQ6IHN0cmluZztcbiAgICBsZXQgbnVtVG9rZW5zOiBudW1iZXI7XG5cbiAgICBkbyB7XG4gICAgICBjb25zdCBuZXh0UHJvbXB0ID0gYCR7cHJvbXB0UHJlZml4fSR7bmV4dFByb21wdEJvZHl9JHtwcm9tcHRTdWZmaXh9YDtcbiAgICAgIGNvbnN0IG5leHROdW1Ub2tlbnMgPSBhd2FpdCB0aGlzLl9nZXRUb2tlbkNvdW50KG5leHRQcm9tcHQpO1xuICAgICAgY29uc3QgaXNWYWxpZFByb21wdCA9IG5leHROdW1Ub2tlbnMgPD0gbWF4TnVtVG9rZW5zO1xuXG4gICAgICBpZiAocHJvbXB0ICYmICFpc1ZhbGlkUHJvbXB0KSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBwcm9tcHRCb2R5ID0gbmV4dFByb21wdEJvZHk7XG4gICAgICBwcm9tcHQgPSBuZXh0UHJvbXB0O1xuICAgICAgbnVtVG9rZW5zID0gbmV4dE51bVRva2VucztcblxuICAgICAgaWYgKCFpc1ZhbGlkUHJvbXB0KSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXBhcmVudE1lc3NhZ2VJZCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGFyZW50TWVzc2FnZSA9IGF3YWl0IHRoaXMuX2dldE1lc3NhZ2VCeUlkKHBhcmVudE1lc3NhZ2VJZCk7XG4gICAgICBpZiAoIXBhcmVudE1lc3NhZ2UpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhcmVudE1lc3NhZ2VSb2xlID0gcGFyZW50TWVzc2FnZS5yb2xlIHx8IFwidXNlclwiO1xuICAgICAgY29uc3QgcGFyZW50TWVzc2FnZVJvbGVEZXNjID1cbiAgICAgICAgcGFyZW50TWVzc2FnZVJvbGUgPT09IFwidXNlclwiID8gdGhpcy5fdXNlckxhYmVsIDogdGhpcy5fYXNzaXN0YW50TGFiZWw7XG5cbiAgICAgIC8vIFRPRE86IGRpZmZlcmVudGlhdGUgYmV0d2VlbiBhc3Npc3RhbnQgYW5kIHVzZXIgbWVzc2FnZXNcbiAgICAgIGNvbnN0IHBhcmVudE1lc3NhZ2VTdHJpbmcgPSBgJHtwYXJlbnRNZXNzYWdlUm9sZURlc2N9OlxcblxcbiR7cGFyZW50TWVzc2FnZS50ZXh0fSR7dGhpcy5fZW5kVG9rZW59XFxuXFxuYDtcbiAgICAgIG5leHRQcm9tcHRCb2R5ID0gYCR7cGFyZW50TWVzc2FnZVN0cmluZ30ke3Byb21wdEJvZHl9YDtcbiAgICAgIHBhcmVudE1lc3NhZ2VJZCA9IHBhcmVudE1lc3NhZ2UucGFyZW50TWVzc2FnZUlkO1xuICAgIH0gd2hpbGUgKHRydWUpO1xuXG4gICAgLy8gVXNlIHVwIHRvIDQwOTYgdG9rZW5zIChwcm9tcHQgKyByZXNwb25zZSksIGJ1dCB0cnkgdG8gbGVhdmUgMTAwMCB0b2tlbnNcbiAgICAvLyBmb3IgdGhlIHJlc3BvbnNlLlxuICAgIGNvbnN0IG1heFRva2VucyA9IE1hdGgubWF4KFxuICAgICAgLTEsXG4gICAgICBNYXRoLm1pbih0aGlzLl9tYXhNb2RlbFRva2VucyAtIG51bVRva2VucywgdGhpcy5fbWF4UmVzcG9uc2VUb2tlbnMpXG4gICAgKTtcbiAgICByZXR1cm4geyBwcm9tcHQsIG1heFRva2VucyB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIF9nZXRUb2tlbkNvdW50KHRleHQ6IHN0cmluZykge1xuICAgIGlmICh0aGlzLl9pc0NoYXRHUFRNb2RlbCkge1xuICAgICAgLy8gV2l0aCB0aGlzIG1vZGVsLCBcIjx8aW1fZW5kfD5cIiBpcyAxIHRva2VuLCBidXQgdG9rZW5pemVycyBhcmVuJ3QgYXdhcmUgb2YgaXQgeWV0LlxuICAgICAgLy8gUmVwbGFjZSBpdCB3aXRoIFwiPHxlbmRvZnRleHR8PlwiICh3aGljaCBpdCBkb2VzIGtub3cgYWJvdXQpIHNvIHRoYXQgdGhlIHRva2VuaXplciBjYW4gY291bnQgaXQgYXMgMSB0b2tlbi5cbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoLzxcXHxpbV9lbmRcXHw+L2csIFwiPHxlbmRvZnRleHR8PlwiKTtcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoLzxcXHxpbV9zZXBcXHw+L2csIFwiPHxlbmRvZnRleHR8PlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZ3B0RW5jb2RlKHRleHQpLmxlbmd0aDtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXQgX2lzQ2hhdEdQVE1vZGVsKCkge1xuICAgIHJldHVybiAoXG4gICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLm1vZGVsLnN0YXJ0c1dpdGgoXCJ0ZXh0LWNoYXRcIikgfHxcbiAgICAgIHRoaXMuX2NvbXBsZXRpb25QYXJhbXMubW9kZWwuc3RhcnRzV2l0aChcInRleHQtZGF2aW5jaS0wMDItcmVuZGVyXCIpIHx8XG4gICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLm1vZGVsLnN0YXJ0c1dpdGgoXCJncHQtXCIpXG4gICAgKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBfZGVmYXVsdEdldE1lc3NhZ2VCeUlkKFxuICAgIGlkOiBzdHJpbmdcbiAgKTogUHJvbWlzZTx0eXBlcy5DaGF0TWVzc2FnZT4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMuX21lc3NhZ2VTdG9yZS5nZXQoaWQpO1xuICAgIGNvbnNvbGUubG9nKFwiZ2V0TWVzc2FnZUJ5SWRcIiwgaWQsIHJlcyk7XG4gICAgcmV0dXJuIHJlcztcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBfZGVmYXVsdFVwc2VydE1lc3NhZ2UoXG4gICAgbWVzc2FnZTogdHlwZXMuQ2hhdE1lc3NhZ2VcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gY29uc29sZS5sb2coXCI9PT51cHNlcnRNZXNzYWdlPlwiLCBtZXNzYWdlLmlkLCBtZXNzYWdlKTtcbiAgICBhd2FpdCB0aGlzLl9tZXNzYWdlU3RvcmUuc2V0KG1lc3NhZ2UuaWQsIG1lc3NhZ2UpO1xuICB9XG59XG4iXX0=