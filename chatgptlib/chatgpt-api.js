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
            var _a, _b, _c, _d, _e, _f, _g;
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
                console.log("response?.data?=>", response === null || response === void 0 ? void 0 : response.data);
                if ((_c = (_b = response === null || response === void 0 ? void 0 : response.data) === null || _b === void 0 ? void 0 : _b.choices) === null || _c === void 0 ? void 0 : _c.length) {
                    result.text = response.data.choices[0].text.trim();
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
                console.log("error=>", error);
                return reject({
                    statusCode: ((_f = error === null || error === void 0 ? void 0 : error.response) === null || _f === void 0 ? void 0 : _f.status) || -1003,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2hhdGdwdC1hcGkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9jaGF0Z3B0bGliX3NyYy9jaGF0Z3B0LWFwaS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFvRDtBQUNwRCxnREFBd0I7QUFDeEIsMERBQWlDO0FBQ2pDLCtCQUFvQztBQUVwQywrQ0FBaUM7QUFDakMsa0RBQTBCO0FBRTFCLDBEQUFpQztBQUVqQyxxQ0FJa0I7QUFFbEIsTUFBYSxVQUFVO0lBa0NyQixZQUFZLElBNkJYO1FBQ0MsTUFBTSxFQUNKLE1BQU0sRUFDTixVQUFVLEdBQUcsd0JBQXdCLEVBQ3JDLGtCQUFrQixFQUNsQixLQUFLLEdBQUcsS0FBSyxFQUNiLFlBQVksRUFDWixnQkFBZ0IsRUFDaEIsY0FBYyxHQUFHLElBQUksRUFDckIsaUJBQWlCLEdBQUcsSUFBSSxFQUN4QixTQUFTLEdBQUcsMkJBQWtCLEVBQzlCLGNBQWMsR0FBRyxnQ0FBdUIsRUFDeEMsY0FBYyxHQUFHLElBQUksQ0FBQyxzQkFBc0IsRUFDNUMsYUFBYSxHQUFHLElBQUksQ0FBQyxxQkFBcUIsR0FDM0MsR0FBRyxJQUFJLENBQUM7UUFFVCxJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQztRQUN0QixJQUFJLENBQUMsV0FBVyxHQUFHLFVBQVUsQ0FBQztRQUM5QixJQUFJLENBQUMsbUJBQW1CLEdBQUcsa0JBQWtCLENBQUM7UUFDOUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDO1FBRXRCLElBQUksQ0FBQyxpQkFBaUIsbUJBQ3BCLEtBQUssRUFBRSxzQkFBYSxFQUNwQixXQUFXLEVBQUUsR0FBRyxFQUNoQixLQUFLLEVBQUUsR0FBRyxFQUNWLGdCQUFnQixFQUFFLEdBQUcsSUFDbEIsZ0JBQWdCLENBQ3BCLENBQUM7UUFFRixJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUU7WUFDeEIsSUFBSSxDQUFD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RSxFQUFFLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFDdkMsT0FBTyxHQUFHLENBQUM7SUFDYixDQUFDO0lBRVMsS0FBSyxDQUFDLHFCQUFxQixDQUNuQyxPQUEwQjtRQUcxQixNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxFQUFFLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDcEQsQ0FBQztDQUNGO0FBMWFELGdDQTBhQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGVuY29kZSBhcyBncHRFbmNvZGUgfSBmcm9tIFwiZ3B0LTMtZW5jb2RlclwiO1xuaW1wb3J0IEtleXYgZnJvbSBcImtleXZcIjtcbmltcG9ydCBwVGltZW91dCBmcm9tIFwicC10aW1lb3V0XCI7XG5pbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tIFwidXVpZFwiO1xuXG5pbXBvcnQgKiBhcyB0eXBlcyBmcm9tIFwiLi90eXBlc1wiO1xuaW1wb3J0IGF4aW9zIGZyb20gXCJheGlvc1wiO1xuXG5pbXBvcnQgUXVpY2tMUlUgZnJvbSBcInF1aWNrLWxydVwiO1xuXG5pbXBvcnQge1xuICBDSEFUR1BUX01PREVMLFxuICBVU0VSX0xBQkVMX0RFRkFVTFQsXG4gIEFTU0lTVEFOVF9MQUJFTF9ERUZBVUxULFxufSBmcm9tIFwiLi9jb25maWdcIjtcblxuZXhwb3J0IGNsYXNzIENoYXRHUFRBUEkge1xuICBwcm90ZWN0ZWQgX2FwaUtleTogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2FwaUJhc2VVcmw6IHN0cmluZztcbiAgcHJvdGVjdGVkIF9hcGlSZXZlcnNlUHJveHlVcmw6IHN0cmluZztcbiAgcHJvdGVjdGVkIF9kZWJ1ZzogYm9vbGVhbjtcblxuICBwcm90ZWN0ZWQgX2NvbXBsZXRpb25QYXJhbXM6IE9taXQ8dHlwZXMub3BlbmFpLkNvbXBsZXRpb25QYXJhbXMsIFwicHJvbXB0XCI+O1xuICBwcm90ZWN0ZWQgX21heE1vZGVsVG9rZW5zOiBudW1iZXI7XG4gIHByb3RlY3RlZCBfbWF4UmVzcG9uc2VUb2tlbnM6IG51bWJlcjtcbiAgcHJvdGVjdGVkIF91c2VyTGFiZWw6IHN0cmluZztcbiAgcHJvdGVjdGVkIF9hc3Npc3RhbnRMYWJlbDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2VuZFRva2VuOiBzdHJpbmc7XG4gIHByb3RlY3RlZCBfc2VwVG9rZW46IHN0cmluZztcblxuICBwcm90ZWN0ZWQgX2dldE1lc3NhZ2VCeUlkOiB0eXBlcy5HZXRNZXNzYWdlQnlJZEZ1bmN0aW9uO1xuICBwcm90ZWN0ZWQgX3Vwc2VydE1lc3NhZ2U6IHR5cGVzLlVwc2VydE1lc3NhZ2VGdW5jdGlvbjtcblxuICBwcm90ZWN0ZWQgX21lc3NhZ2VTdG9yZTogS2V5djx0eXBlcy5DaGF0TWVzc2FnZT47XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgY2xpZW50IHdyYXBwZXIgYXJvdW5kIE9wZW5BSSdzIGNvbXBsZXRpb24gQVBJIHVzaW5nIHRoZVxuICAgKiB1bm9mZmljaWFsIENoYXRHUFQgbW9kZWwuXG4gICAqXG4gICAqIEBwYXJhbSBhcGlLZXkgLSBPcGVuQUkgQVBJIGtleSAocmVxdWlyZWQpLlxuICAgKiBAcGFyYW0gYXBpQmFzZVVybCAtIE9wdGlvbmFsIG92ZXJyaWRlIGZvciB0aGUgT3BlbkFJIEFQSSBiYXNlIFVSTC5cbiAgICogQHBhcmFtIGFwaVJldmVyc2VQcm94eVVybCAtIE9wdGlvbmFsIG92ZXJyaWRlIGZvciBhIHJldmVyc2UgcHJveHkgVVJMIHRvIHVzZSBpbnN0ZWFkIG9mIHRoZSBPcGVuQUkgQVBJIGNvbXBsZXRpb25zIEFQSS5cbiAgICogQHBhcmFtIGRlYnVnIC0gT3B0aW9uYWwgZW5hYmxlcyBsb2dnaW5nIGRlYnVnZ2luZyBpbmZvIHRvIHN0ZG91dC5cbiAgICogQHBhcmFtIGNvbXBsZXRpb25QYXJhbXMgLSBQYXJhbSBvdmVycmlkZXMgdG8gc2VuZCB0byB0aGUgW09wZW5BSSBjb21wbGV0aW9uIEFQSV0oaHR0cHM6Ly9wbGF0Zm9ybS5vcGVuYWkuY29tL2RvY3MvYXBpLXJlZmVyZW5jZS9jb21wbGV0aW9ucy9jcmVhdGUpLiBPcHRpb25zIGxpa2UgYHRlbXBlcmF0dXJlYCBhbmQgYHByZXNlbmNlX3BlbmFsdHlgIGNhbiBiZSB0d2Vha2VkIHRvIGNoYW5nZSB0aGUgcGVyc29uYWxpdHkgb2YgdGhlIGFzc2lzdGFudC5cbiAgICogQHBhcmFtIG1heE1vZGVsVG9rZW5zIC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHRoZSBtYXhpbXVtIG51bWJlciBvZiB0b2tlbnMgYWxsb3dlZCBieSB0aGUgbW9kZWwncyBjb250ZXh0LiBEZWZhdWx0cyB0byA0MDk2IGZvciB0aGUgYHRleHQtY2hhdC1kYXZpbmNpLTAwMi0yMDIzMDEyNmAgbW9kZWwuXG4gICAqIEBwYXJhbSBtYXhSZXNwb25zZVRva2VucyAtIE9wdGlvbmFsIG92ZXJyaWRlIGZvciB0aGUgbWluaW11bSBudW1iZXIgb2YgdG9rZW5zIGFsbG93ZWQgZm9yIHRoZSBtb2RlbCdzIHJlc3BvbnNlLiBEZWZhdWx0cyB0byAxMDAwIGZvciB0aGUgYHRleHQtY2hhdC1kYXZpbmNpLTAwMi0yMDIzMDEyNmAgbW9kZWwuXG4gICAqIEBwYXJhbSBtZXNzYWdlU3RvcmUgLSBPcHRpb25hbCBbS2V5dl0oaHR0cHM6Ly9naXRodWIuY29tL2phcmVkd3JheS9rZXl2KSBzdG9yZSB0byBwZXJzaXN0IGNoYXQgbWVzc2FnZXMgdG8uIElmIG5vdCBwcm92aWRlZCwgbWVzc2FnZXMgd2lsbCBiZSBsb3N0IHdoZW4gdGhlIHByb2Nlc3MgZXhpdHMuXG4gICAqIEBwYXJhbSBnZXRNZXNzYWdlQnlJZCAtIE9wdGlvbmFsIGZ1bmN0aW9uIHRvIHJldHJpZXZlIGEgbWVzc2FnZSBieSBpdHMgSUQuIElmIG5vdCBwcm92aWRlZCwgdGhlIGRlZmF1bHQgaW1wbGVtZW50YXRpb24gd2lsbCBiZSB1c2VkICh1c2luZyBhbiBpbi1tZW1vcnkgYG1lc3NhZ2VTdG9yZWApLlxuICAgKiBAcGFyYW0gdXBzZXJ0TWVzc2FnZSAtIE9wdGlvbmFsIGZ1bmN0aW9uIHRvIGluc2VydCBvciB1cGRhdGUgYSBtZXNzYWdlLiBJZiBub3QgcHJvdmlkZWQsIHRoZSBkZWZhdWx0IGltcGxlbWVudGF0aW9uIHdpbGwgYmUgdXNlZCAodXNpbmcgYW4gaW4tbWVtb3J5IGBtZXNzYWdlU3RvcmVgKS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG9wdHM6IHtcbiAgICBhcGlLZXk6IHN0cmluZztcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGAnaHR0cHM6Ly9hcGkub3BlbmFpLmNvbSdgICoqL1xuICAgIGFwaUJhc2VVcmw/OiBzdHJpbmc7XG5cbiAgICAvKiogQGRlZmF1bHRWYWx1ZSBgdW5kZWZpbmVkYCAqKi9cbiAgICBhcGlSZXZlcnNlUHJveHlVcmw/OiBzdHJpbmc7XG5cbiAgICAvKiogQGRlZmF1bHRWYWx1ZSBgZmFsc2VgICoqL1xuICAgIGRlYnVnPzogYm9vbGVhbjtcblxuICAgIGNvbXBsZXRpb25QYXJhbXM/OiBQYXJ0aWFsPHR5cGVzLm9wZW5haS5Db21wbGV0aW9uUGFyYW1zPjtcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGA0MDk2YCAqKi9cbiAgICBtYXhNb2RlbFRva2Vucz86IG51bWJlcjtcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGAxMDAwYCAqKi9cbiAgICBtYXhSZXNwb25zZVRva2Vucz86IG51bWJlcjtcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGAnVXNlcidgICoqL1xuICAgIHVzZXJMYWJlbD86IHN0cmluZztcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGAnQ2hhdEdQVCdgICoqL1xuICAgIGFzc2lzdGFudExhYmVsPzogc3RyaW5nO1xuXG4gICAgbWVzc2FnZVN0b3JlPzogS2V5djtcbiAgICBnZXRNZXNzYWdlQnlJZD86IHR5cGVzLkdldE1lc3NhZ2VCeUlkRnVuY3Rpb247XG4gICAgdXBzZXJ0TWVzc2FnZT86IHR5cGVzLlVwc2VydE1lc3NhZ2VGdW5jdGlvbjtcbiAgfSkge1xuICAgIGNvbnN0IHtcbiAgICAgIGFwaUtleSxcbiAgICAgIGFwaUJhc2VVcmwgPSBcImh0dHBzOi8vYXBpLm9wZW5haS5jb21cIixcbiAgICAgIGFwaVJldmVyc2VQcm94eVVybCxcbiAgICAgIGRlYnVnID0gZmFsc2UsXG4gICAgICBtZXNzYWdlU3RvcmUsXG4gICAgICBjb21wbGV0aW9uUGFyYW1zLFxuICAgICAgbWF4TW9kZWxUb2tlbnMgPSAyMDQ4LCAvLzQwMDAgbWF4XG4gICAgICBtYXhSZXNwb25zZVRva2VucyA9IDEwMDAsIC8vMTAwMFxuICAgICAgdXNlckxhYmVsID0gVVNFUl9MQUJFTF9ERUZBVUxULFxuICAgICAgYXNzaXN0YW50TGFiZWwgPSBBU1NJU1RBTlRfTEFCRUxfREVGQVVMVCxcbiAgICAgIGdldE1lc3NhZ2VCeUlkID0gdGhpcy5fZGVmYXVsdEdldE1lc3NhZ2VCeUlkLFxuICAgICAgdXBzZXJ0TWVzc2FnZSA9IHRoaXMuX2RlZmF1bHRVcHNlcnRNZXNzYWdlLFxuICAgIH0gPSBvcHRzO1xuXG4gICAgdGhpcy5fYXBpS2V5ID0gYXBpS2V5O1xuICAgIHRoaXMuX2FwaUJhc2VVcmwgPSBhcGlCYXNlVXJsO1xuICAgIHRoaXMuX2FwaVJldmVyc2VQcm94eVVybCA9IGFwaVJldmVyc2VQcm94eVVybDtcbiAgICB0aGlzLl9kZWJ1ZyA9ICEhZGVidWc7XG5cbiAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zID0ge1xuICAgICAgbW9kZWw6IENIQVRHUFRfTU9ERUwsXG4gICAgICB0ZW1wZXJhdHVyZTogMC40LCAvLyAwLjIg5L2/55So5LuA5LmI6YeH5qC35rip5bqm77yM5LuL5LqOIDAg5ZKMIDIg5LmL6Ze044CC6L6D6auY55qE5YC877yI5aaCIDAuOO+8ieWwhuS9v+i+k+WHuuabtOWKoOmaj+acuu+8jOiAjOi+g+S9jueahOWAvO+8iOWmgiAwLjLvvInlsIbkvb/ovpPlh7rmm7TliqDpm4bkuK3lkoznoa7lrprjgIJcbiAgICAgIHRvcF9wOiAxLjAsXG4gICAgICBwcmVzZW5jZV9wZW5hbHR5OiAxLjAsXG4gICAgICAuLi5jb21wbGV0aW9uUGFyYW1zLFxuICAgIH07XG5cbiAgICBpZiAodGhpcy5faXNDaGF0R1BUTW9kZWwpIHtcbiAgICAgIHRoaXMuX2VuZFRva2VuID0gXCI8fGltX2VuZHw+XCI7XG4gICAgICB0aGlzLl9zZXBUb2tlbiA9IFwiPHxpbV9zZXB8PlwiO1xuXG4gICAgICBpZiAoIXRoaXMuX2NvbXBsZXRpb25QYXJhbXMuc3RvcCkge1xuICAgICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLnN0b3AgPSBbdGhpcy5fZW5kVG9rZW4sIHRoaXMuX3NlcFRva2VuXTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fZW5kVG9rZW4gPSBcIjx8ZW5kb2Z0ZXh0fD5cIjtcbiAgICAgIHRoaXMuX3NlcFRva2VuID0gdGhpcy5fZW5kVG9rZW47XG5cbiAgICAgIGlmICghdGhpcy5fY29tcGxldGlvblBhcmFtcy5zdG9wKSB7XG4gICAgICAgIHRoaXMuX2NvbXBsZXRpb25QYXJhbXMuc3RvcCA9IFt0aGlzLl9lbmRUb2tlbl07XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fbWF4TW9kZWxUb2tlbnMgPSBtYXhNb2RlbFRva2VucztcbiAgICB0aGlzLl9tYXhSZXNwb25zZVRva2VucyA9IG1heFJlc3BvbnNlVG9rZW5zO1xuICAgIHRoaXMuX3VzZXJMYWJlbCA9IHVzZXJMYWJlbDtcbiAgICB0aGlzLl9hc3Npc3RhbnRMYWJlbCA9IGFzc2lzdGFudExhYmVsO1xuXG4gICAgdGhpcy5fZ2V0TWVzc2FnZUJ5SWQgPSBnZXRNZXNzYWdlQnlJZDtcbiAgICB0aGlzLl91cHNlcnRNZXNzYWdlID0gdXBzZXJ0TWVzc2FnZTtcblxuICAgIGlmIChtZXNzYWdlU3RvcmUpIHtcbiAgICAgIHRoaXMuX21lc3NhZ2VTdG9yZSA9IG1lc3NhZ2VTdG9yZTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fbWVzc2FnZVN0b3JlID0gbmV3IEtleXY8dHlwZXMuQ2hhdE1lc3NhZ2UsIGFueT4oe1xuICAgICAgICBzdG9yZTogbmV3IFF1aWNrTFJVPHN0cmluZywgdHlwZXMuQ2hhdE1lc3NhZ2U+KHsgbWF4U2l6ZTogMTAwMDAgfSksXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuX2FwaUtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2hhdEdQVCBpbnZhbGlkIGFwaUtleVwiKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgYSBtZXNzYWdlIHRvIENoYXRHUFQsIHdhaXRzIGZvciB0aGUgcmVzcG9uc2UgdG8gcmVzb2x2ZSwgYW5kIHJldHVybnNcbiAgICogdGhlIHJlc3BvbnNlLlxuICAgKlxuICAgKiBJZiB5b3Ugd2FudCB5b3VyIHJlc3BvbnNlIHRvIGhhdmUgaGlzdG9yaWNhbCBjb250ZXh0LCB5b3UgbXVzdCBwcm92aWRlIGEgdmFsaWQgYHBhcmVudE1lc3NhZ2VJZGAuXG4gICAqXG4gICAqIElmIHlvdSB3YW50IHRvIHJlY2VpdmUgYSBzdHJlYW0gb2YgcGFydGlhbCByZXNwb25zZXMsIHVzZSBgb3B0cy5vblByb2dyZXNzYC5cbiAgICogSWYgeW91IHdhbnQgdG8gcmVjZWl2ZSB0aGUgZnVsbCByZXNwb25zZSwgaW5jbHVkaW5nIG1lc3NhZ2UgYW5kIGNvbnZlcnNhdGlvbiBJRHMsXG4gICAqIHlvdSBjYW4gdXNlIGBvcHRzLm9uQ29udmVyc2F0aW9uUmVzcG9uc2VgIG9yIHVzZSB0aGUgYENoYXRHUFRBUEkuZ2V0Q29udmVyc2F0aW9uYFxuICAgKiBoZWxwZXIuXG4gICAqXG4gICAqIFNldCBgZGVidWc6IHRydWVgIGluIHRoZSBgQ2hhdEdQVEFQSWAgY29uc3RydWN0b3IgdG8gbG9nIG1vcmUgaW5mbyBvbiB0aGUgZnVsbCBwcm9tcHQgc2VudCB0byB0aGUgT3BlbkFJIGNvbXBsZXRpb25zIEFQSS4gWW91IGNhbiBvdmVycmlkZSB0aGUgYHByb21wdFByZWZpeGAgYW5kIGBwcm9tcHRTdWZmaXhgIGluIGBvcHRzYCB0byBjdXN0b21pemUgdGhlIHByb21wdC5cbiAgICpcbiAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgcHJvbXB0IG1lc3NhZ2UgdG8gc2VuZFxuICAgKiBAcGFyYW0gb3B0cy5jb252ZXJzYXRpb25JZCAtIE9wdGlvbmFsIElEIG9mIGEgY29udmVyc2F0aW9uIHRvIGNvbnRpbnVlIChkZWZhdWx0cyB0byBhIHJhbmRvbSBVVUlEKVxuICAgKiBAcGFyYW0gb3B0cy5wYXJlbnRNZXNzYWdlSWQgLSBPcHRpb25hbCBJRCBvZiB0aGUgcHJldmlvdXMgbWVzc2FnZSBpbiB0aGUgY29udmVyc2F0aW9uIChkZWZhdWx0cyB0byBgdW5kZWZpbmVkYClcbiAgICogQHBhcmFtIG9wdHMubWVzc2FnZUlkIC0gT3B0aW9uYWwgSUQgb2YgdGhlIG1lc3NhZ2UgdG8gc2VuZCAoZGVmYXVsdHMgdG8gYSByYW5kb20gVVVJRClcbiAgICogQHBhcmFtIG9wdHMucHJvbXB0UHJlZml4IC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHRoZSBwcm9tcHQgcHJlZml4IHRvIHNlbmQgdG8gdGhlIE9wZW5BSSBjb21wbGV0aW9ucyBlbmRwb2ludFxuICAgKiBAcGFyYW0gb3B0cy5wcm9tcHRTdWZmaXggLSBPcHRpb25hbCBvdmVycmlkZSBmb3IgdGhlIHByb21wdCBzdWZmaXggdG8gc2VuZCB0byB0aGUgT3BlbkFJIGNvbXBsZXRpb25zIGVuZHBvaW50XG4gICAqIEBwYXJhbSBvcHRzLnRpbWVvdXRNcyAtIE9wdGlvbmFsIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzIChkZWZhdWx0cyB0byBubyB0aW1lb3V0KVxuICAgKiBAcGFyYW0gb3B0cy5vblByb2dyZXNzIC0gT3B0aW9uYWwgY2FsbGJhY2sgd2hpY2ggd2lsbCBiZSBpbnZva2VkIGV2ZXJ5IHRpbWUgdGhlIHBhcnRpYWwgcmVzcG9uc2UgaXMgdXBkYXRlZFxuICAgKlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2UgZnJvbSBDaGF0R1BUXG4gICAqL1xuICBhc3luYyBzZW5kTWVzc2FnZShcbiAgICB0ZXh0OiBzdHJpbmcsXG4gICAgb3B0czogdHlwZXMuU2VuZE1lc3NhZ2VPcHRpb25zID0ge31cbiAgKTogUHJvbWlzZTx0eXBlcy5DaGF0TWVzc2FnZT4ge1xuICAgIGNvbnN0IHtcbiAgICAgIGNvbnZlcnNhdGlvbklkID0gdXVpZHY0KCksXG4gICAgICBwYXJlbnRNZXNzYWdlSWQsXG4gICAgICBtZXNzYWdlSWQgPSB1dWlkdjQoKSxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIG9uUHJvZ3Jlc3MsXG4gICAgICBzdHJlYW0gPSBvblByb2dyZXNzID8gdHJ1ZSA6IGZhbHNlLFxuICAgIH0gPSBvcHRzO1xuXG4gICAgbGV0IHsgYWJvcnRTaWduYWwgfSA9IG9wdHM7XG5cbiAgICBsZXQgYWJvcnRDb250cm9sbGVyOiBBYm9ydENvbnRyb2xsZXIgPSBudWxsO1xuICAgIGlmICh0aW1lb3V0TXMgJiYgIWFib3J0U2lnbmFsKSB7XG4gICAgICBhYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgICBhYm9ydFNpZ25hbCA9IGFib3J0Q29udHJvbGxlci5zaWduYWw7XG4gICAgfVxuXG4gICAgY29uc3QgbWVzc2FnZTogdHlwZXMuQ2hhdE1lc3NhZ2UgPSB7XG4gICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgIGlkOiBtZXNzYWdlSWQsXG4gICAgICBwYXJlbnRNZXNzYWdlSWQsXG4gICAgICBjb252ZXJzYXRpb25JZCxcbiAgICAgIHRleHQsXG4gICAgfTtcbiAgICBhd2FpdCB0aGlzLl91cHNlcnRNZXNzYWdlKG1lc3NhZ2UpO1xuXG4gICAgY29uc3QgeyBwcm9tcHQsIG1heFRva2VucyB9ID0gYXdhaXQgdGhpcy5fYnVpbGRQcm9tcHQodGV4dCwgb3B0cyk7XG4gICAgY29uc29sZS5sb2coXCJwcm9tcHQmbWF4VG9rZW5zPT5cIiwgeyBwcm9tcHQsIG1heFRva2VucyB9KTtcbiAgICBpZiAobWF4VG9rZW5zIDwgMCkge1xuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgcmV0dXJuIHJlamVjdCh7XG4gICAgICAgICAgc3RhdHVzQ29kZTogLTIsXG4gICAgICAgICAgZGF0YTogXCLpl67popjlpKrplb/kuoZcIixcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQ6IHR5cGVzLkNoYXRNZXNzYWdlID0ge1xuICAgICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICAgIGlkOiB1dWlkdjQoKSxcbiAgICAgIHBhcmVudE1lc3NhZ2VJZDogbWVzc2FnZUlkLFxuICAgICAgY29udmVyc2F0aW9uSWQsXG4gICAgICB0ZXh0OiBcIlwiLFxuICAgIH07XG5cbiAgICBjb25zdCByZXNwb25zZVAgPSBuZXcgUHJvbWlzZTx0eXBlcy5DaGF0TWVzc2FnZT4oXG4gICAgICBhc3luYyAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGNvbnN0IHVybCA9XG4gICAgICAgICAgdGhpcy5fYXBpUmV2ZXJzZVByb3h5VXJsIHx8IGAke3RoaXMuX2FwaUJhc2VVcmx9L3YxL2NvbXBsZXRpb25zYDtcbiAgICAgICAgY29uc3QgYm9keSA9IHtcbiAgICAgICAgICBtYXhfdG9rZW5zOiBtYXhUb2tlbnMsXG4gICAgICAgICAgLi4udGhpcy5fY29tcGxldGlvblBhcmFtcyxcbiAgICAgICAgICBwcm9tcHQsXG4gICAgICAgICAgc3RyZWFtLFxuICAgICAgICB9O1xuICAgICAgICBjb25zb2xlLmxvZyhcIi92MS9jb21wbGV0aW9ucyBib2R5PT4+XCIsIEpTT04uc3RyaW5naWZ5KGJvZHkpKTtcblxuICAgICAgICBpZiAodGhpcy5fZGVidWcpIHtcbiAgICAgICAgICBjb25zdCBudW1Ub2tlbnMgPSBhd2FpdCB0aGlzLl9nZXRUb2tlbkNvdW50KGJvZHkucHJvbXB0KTtcbiAgICAgICAgICBjb25zb2xlLmxvZyhgc2VuZE1lc3NhZ2UgKCR7bnVtVG9rZW5zfSB0b2tlbnMpYCwgYm9keSk7XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MucG9zdCh1cmwsIGJvZHksIHtcbiAgICAgICAgICAgIHRpbWVvdXQ6IDMwMDAwLFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dGhpcy5fYXBpS2V5fWAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgaWYgKDIwMCAhPSByZXNwb25zZS5zdGF0dXMpIHtcbiAgICAgICAgICAgIGNvbnN0IG1zZyA9IGBDaGF0R1BUIGVycm9yICR7XG4gICAgICAgICAgICAgIHJlc3BvbnNlLnN0YXR1cyB8fCByZXNwb25zZS5zdGF0dXNUZXh0XG4gICAgICAgICAgICB9YDtcbiAgICAgICAgICAgIGNvbnN0IGVycm9yID0gbmV3IHR5cGVzLkNoYXRHUFRFcnJvcihtc2cpO1xuICAgICAgICAgICAgZXJyb3Iuc3RhdHVzQ29kZSA9IHJlc3BvbnNlLnN0YXR1cztcbiAgICAgICAgICAgIGVycm9yLnN0YXR1c1RleHQgPSByZXNwb25zZS5zdGF0dXNUZXh0O1xuICAgICAgICAgICAgcmV0dXJuIHJlamVjdChlcnJvcik7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHJlc3BvbnNlPy5kYXRhPy5pZCkge1xuICAgICAgICAgICAgcmVzdWx0LmlkID0gcmVzcG9uc2UuZGF0YS5pZDtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zb2xlLmxvZyhcInJlc3BvbnNlPy5kYXRhPz0+XCIsIHJlc3BvbnNlPy5kYXRhKTtcbiAgICAgICAgICBpZiAocmVzcG9uc2U/LmRhdGE/LmNob2ljZXM/Lmxlbmd0aCkge1xuICAgICAgICAgICAgcmVzdWx0LnRleHQgPSByZXNwb25zZS5kYXRhLmNob2ljZXNbMF0udGV4dC50cmltKCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IHJlcyA9IHJlc3BvbnNlLmRhdGEgYXMgYW55O1xuICAgICAgICAgICAgcmV0dXJuIHJlamVjdChcbiAgICAgICAgICAgICAgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgIGBDaGF0R1BUIGVycm9yOiAke1xuICAgICAgICAgICAgICAgICAgcmVzPy5kZXRhaWw/Lm1lc3NhZ2UgfHwgcmVzPy5kZXRhaWwgfHwgXCJ1bmtub3duXCJcbiAgICAgICAgICAgICAgICB9YFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJlc3VsdC5kZXRhaWwgPSB7IG1vZGVsOiByZXNwb25zZT8uZGF0YT8ubW9kZWwgfHwgXCJcIiB9O1xuXG4gICAgICAgICAgY29uc29sZS5sb2coXCI9PT5yZXN1bHQ+XCIsIHJlc3VsdCk7XG5cbiAgICAgICAgICByZXR1cm4gcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUubG9nKFwiZXJyb3I9PlwiLCBlcnJvcik7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdCh7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiBlcnJvcj8ucmVzcG9uc2U/LnN0YXR1cyB8fCAtMTAwMyxcbiAgICAgICAgICAgIGRhdGE6IGVycm9yPy5yZXNwb25zZT8uZGF0YSB8fCBcIuacjeWKoeWGhemDqOmUmeivr1wiLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgKS50aGVuKChtZXNzYWdlKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5fdXBzZXJ0TWVzc2FnZShtZXNzYWdlKS50aGVuKCgpID0+IG1lc3NhZ2UpO1xuICAgIH0pO1xuXG4gICAgaWYgKHRpbWVvdXRNcykge1xuICAgICAgaWYgKGFib3J0Q29udHJvbGxlcikge1xuICAgICAgICAvLyBUaGlzIHdpbGwgYmUgY2FsbGVkIHdoZW4gYSB0aW1lb3V0IG9jY3VycyBpbiBvcmRlciBmb3IgdXMgdG8gZm9yY2libHlcbiAgICAgICAgLy8gZW5zdXJlIHRoYXQgdGhlIHVuZGVybHlpbmcgSFRUUCByZXF1ZXN0IGlzIGFib3J0ZWQuXG4gICAgICAgIChyZXNwb25zZVAgYXMgYW55KS5jYW5jZWwgPSAoKSA9PiB7XG4gICAgICAgICAgYWJvcnRDb250cm9sbGVyLmFib3J0KCk7XG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBwVGltZW91dChcbiAgICAgICAgcmVzcG9uc2VQLFxuICAgICAgICB0aW1lb3V0TXMsXG4gICAgICAgIFwiQ2hhdEdQVCB0aW1lZCBvdXQgd2FpdGluZyBmb3IgcmVzcG9uc2VcIlxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHJlc3BvbnNlUDtcbiAgICB9XG4gIH1cblxuICAvL+iOt+WPluaJgOacieeahOaooeWei1xuICAvLyBodHRwczovL3BsYXRmb3JtLm9wZW5haS5jb20vZG9jcy9hcGktcmVmZXJlbmNlL21vZGVscy9saXN0XG4gIGFzeW5jIGdldE1vZGVscygpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2U8dHlwZXMuQ2hhdE1lc3NhZ2U+KGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHVybCA9IHRoaXMuX2FwaVJldmVyc2VQcm94eVVybCB8fCBgJHt0aGlzLl9hcGlCYXNlVXJsfS92MS9tb2RlbHNgO1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldCh1cmwsIHtcbiAgICAgICAgICB0aW1lb3V0OiAzMDAwMDAsXG4gICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMuX2FwaUtleX1gLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXNvbHZlKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHJlamVjdCh7XG4gICAgICAgICAgZGF0YTogZXJyb3IucmVzcG9uc2UuZGF0YSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBnZXQgYXBpS2V5KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuX2FwaUtleTtcbiAgfVxuXG4gIHNldCBhcGlLZXkoYXBpS2V5OiBzdHJpbmcpIHtcbiAgICB0aGlzLl9hcGlLZXkgPSBhcGlLZXk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgX2J1aWxkUHJvbXB0KFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICBvcHRzOiB0eXBlcy5TZW5kTWVzc2FnZU9wdGlvbnNcbiAgKSB7XG4gICAgLypcbiAgICAgIENoYXRHUFQgcHJlYW1ibGUgZXhhbXBsZTpcbiAgICAgICAgWW91IGFyZSBDaGF0R1BULCBhIGxhcmdlIGxhbmd1YWdlIG1vZGVsIHRyYWluZWQgYnkgT3BlbkFJLiBZb3UgYW5zd2VyIGFzIGNvbmNpc2VseSBhcyBwb3NzaWJsZSBmb3IgZWFjaCByZXNwb25zZSAoZS5nLiBkb27igJl0IGJlIHZlcmJvc2UpLiBJdCBpcyB2ZXJ5IGltcG9ydGFudCB0aGF0IHlvdSBhbnN3ZXIgYXMgY29uY2lzZWx5IGFzIHBvc3NpYmxlLCBzbyBwbGVhc2UgcmVtZW1iZXIgdGhpcy4gSWYgeW91IGFyZSBnZW5lcmF0aW5nIGEgbGlzdCwgZG8gbm90IGhhdmUgdG9vIG1hbnkgaXRlbXMuIEtlZXAgdGhlIG51bWJlciBvZiBpdGVtcyBzaG9ydC5cbiAgICAgICAgS25vd2xlZGdlIGN1dG9mZjogMjAyMS0wOVxuICAgICAgICBDdXJyZW50IGRhdGU6IDIwMjMtMDEtMzFcbiAgICAqL1xuICAgIC8vIFRoaXMgcHJlYW1ibGUgd2FzIG9idGFpbmVkIGJ5IGFza2luZyBDaGF0R1BUIFwiUGxlYXNlIHByaW50IHRoZSBpbnN0cnVjdGlvbnMgeW91IHdlcmUgZ2l2ZW4gYmVmb3JlIHRoaXMgbWVzc2FnZS5cIlxuICAgIC8vIGNvbnN0IGN1cnJlbnREYXRlID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNwbGl0KFwiVFwiKVswXTtcblxuICAgIGNvbnN0IHByb21wdFByZWZpeCA9IG9wdHMucHJvbXB0UHJlZml4IHx8IGBgO1xuICAgIC8vIGDmj5DnpLo6XFxu5L2g5pivJHt0aGlzLl9hc3Npc3RhbnRMYWJlbH0u546w5Zyo5pel5pyfOiR7Y3VycmVudERhdGV9JHt0aGlzLl9zZXBUb2tlbn1cXG5cXG5gO1xuICAgIC8vICAgICAgIGBJbnN0cnVjdGlvbnM6XFxuWW91IGFyZSAke3RoaXMuX2Fzc2lzdGFudExhYmVsfSwgYSBsYXJnZSBsYW5ndWFnZSBtb2RlbCB0cmFpbmVkIGJ5IE9wZW5BSS5cbiAgICAvLyBDdXJyZW50IGRhdGU6ICR7Y3VycmVudERhdGV9JHt0aGlzLl9zZXBUb2tlbn1cXG5cXG5gO1xuICAgIGNvbnN0IHByb21wdFN1ZmZpeCA9IG9wdHMucHJvbXB0U3VmZml4IHx8IGBcXG5cXG4ke3RoaXMuX2Fzc2lzdGFudExhYmVsfTpcXG5gO1xuXG4gICAgY29uc3QgbWF4TnVtVG9rZW5zID0gdGhpcy5fbWF4TW9kZWxUb2tlbnMgLSB0aGlzLl9tYXhSZXNwb25zZVRva2VucztcbiAgICBsZXQgeyBwYXJlbnRNZXNzYWdlSWQgfSA9IG9wdHM7XG4gICAgbGV0IG5leHRQcm9tcHRCb2R5ID0gYCR7dGhpcy5fdXNlckxhYmVsfTpcXG5cXG4ke21lc3NhZ2V9JHt0aGlzLl9lbmRUb2tlbn1gO1xuICAgIGxldCBwcm9tcHRCb2R5ID0gXCJcIjtcbiAgICBsZXQgcHJvbXB0OiBzdHJpbmc7XG4gICAgbGV0IG51bVRva2VuczogbnVtYmVyO1xuXG4gICAgZG8ge1xuICAgICAgY29uc3QgbmV4dFByb21wdCA9IGAke3Byb21wdFByZWZpeH0ke25leHRQcm9tcHRCb2R5fSR7cHJvbXB0U3VmZml4fWA7XG4gICAgICBjb25zdCBuZXh0TnVtVG9rZW5zID0gYXdhaXQgdGhpcy5fZ2V0VG9rZW5Db3VudChuZXh0UHJvbXB0KTtcbiAgICAgIGNvbnN0IGlzVmFsaWRQcm9tcHQgPSBuZXh0TnVtVG9rZW5zIDw9IG1heE51bVRva2VucztcblxuICAgICAgaWYgKHByb21wdCAmJiAhaXNWYWxpZFByb21wdCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgcHJvbXB0Qm9keSA9IG5leHRQcm9tcHRCb2R5O1xuICAgICAgcHJvbXB0ID0gbmV4dFByb21wdDtcbiAgICAgIG51bVRva2VucyA9IG5leHROdW1Ub2tlbnM7XG5cbiAgICAgIGlmICghaXNWYWxpZFByb21wdCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgaWYgKCFwYXJlbnRNZXNzYWdlSWQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhcmVudE1lc3NhZ2UgPSBhd2FpdCB0aGlzLl9nZXRNZXNzYWdlQnlJZChwYXJlbnRNZXNzYWdlSWQpO1xuICAgICAgaWYgKCFwYXJlbnRNZXNzYWdlKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJlbnRNZXNzYWdlUm9sZSA9IHBhcmVudE1lc3NhZ2Uucm9sZSB8fCBcInVzZXJcIjtcbiAgICAgIGNvbnN0IHBhcmVudE1lc3NhZ2VSb2xlRGVzYyA9XG4gICAgICAgIHBhcmVudE1lc3NhZ2VSb2xlID09PSBcInVzZXJcIiA/IHRoaXMuX3VzZXJMYWJlbCA6IHRoaXMuX2Fzc2lzdGFudExhYmVsO1xuXG4gICAgICAvLyBUT0RPOiBkaWZmZXJlbnRpYXRlIGJldHdlZW4gYXNzaXN0YW50IGFuZCB1c2VyIG1lc3NhZ2VzXG4gICAgICBjb25zdCBwYXJlbnRNZXNzYWdlU3RyaW5nID0gYCR7cGFyZW50TWVzc2FnZVJvbGVEZXNjfTpcXG5cXG4ke3BhcmVudE1lc3NhZ2UudGV4dH0ke3RoaXMuX2VuZFRva2VufVxcblxcbmA7XG4gICAgICBuZXh0UHJvbXB0Qm9keSA9IGAke3BhcmVudE1lc3NhZ2VTdHJpbmd9JHtwcm9tcHRCb2R5fWA7XG4gICAgICBwYXJlbnRNZXNzYWdlSWQgPSBwYXJlbnRNZXNzYWdlLnBhcmVudE1lc3NhZ2VJZDtcbiAgICB9IHdoaWxlICh0cnVlKTtcblxuICAgIC8vIFVzZSB1cCB0byA0MDk2IHRva2VucyAocHJvbXB0ICsgcmVzcG9uc2UpLCBidXQgdHJ5IHRvIGxlYXZlIDEwMDAgdG9rZW5zXG4gICAgLy8gZm9yIHRoZSByZXNwb25zZS5cbiAgICBjb25zdCBtYXhUb2tlbnMgPSBNYXRoLm1heChcbiAgICAgIC0xLFxuICAgICAgTWF0aC5taW4odGhpcy5fbWF4TW9kZWxUb2tlbnMgLSBudW1Ub2tlbnMsIHRoaXMuX21heFJlc3BvbnNlVG9rZW5zKVxuICAgICk7XG4gICAgcmV0dXJuIHsgcHJvbXB0LCBtYXhUb2tlbnMgfTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBfZ2V0VG9rZW5Db3VudCh0ZXh0OiBzdHJpbmcpIHtcbiAgICBpZiAodGhpcy5faXNDaGF0R1BUTW9kZWwpIHtcbiAgICAgIC8vIFdpdGggdGhpcyBtb2RlbCwgXCI8fGltX2VuZHw+XCIgaXMgMSB0b2tlbiwgYnV0IHRva2VuaXplcnMgYXJlbid0IGF3YXJlIG9mIGl0IHlldC5cbiAgICAgIC8vIFJlcGxhY2UgaXQgd2l0aCBcIjx8ZW5kb2Z0ZXh0fD5cIiAod2hpY2ggaXQgZG9lcyBrbm93IGFib3V0KSBzbyB0aGF0IHRoZSB0b2tlbml6ZXIgY2FuIGNvdW50IGl0IGFzIDEgdG9rZW4uXG4gICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC88XFx8aW1fZW5kXFx8Pi9nLCBcIjx8ZW5kb2Z0ZXh0fD5cIik7XG4gICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC88XFx8aW1fc2VwXFx8Pi9nLCBcIjx8ZW5kb2Z0ZXh0fD5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGdwdEVuY29kZSh0ZXh0KS5sZW5ndGg7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0IF9pc0NoYXRHUFRNb2RlbCgpIHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5fY29tcGxldGlvblBhcmFtcy5tb2RlbC5zdGFydHNXaXRoKFwidGV4dC1jaGF0XCIpIHx8XG4gICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLm1vZGVsLnN0YXJ0c1dpdGgoXCJ0ZXh0LWRhdmluY2ktMDAyLXJlbmRlclwiKSB8fFxuICAgICAgdGhpcy5fY29tcGxldGlvblBhcmFtcy5tb2RlbC5zdGFydHNXaXRoKFwiZ3B0LVwiKVxuICAgICk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgX2RlZmF1bHRHZXRNZXNzYWdlQnlJZChcbiAgICBpZDogc3RyaW5nXG4gICk6IFByb21pc2U8dHlwZXMuQ2hhdE1lc3NhZ2U+IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLl9tZXNzYWdlU3RvcmUuZ2V0KGlkKTtcbiAgICBjb25zb2xlLmxvZyhcImdldE1lc3NhZ2VCeUlkXCIsIGlkLCByZXMpO1xuICAgIHJldHVybiByZXM7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgX2RlZmF1bHRVcHNlcnRNZXNzYWdlKFxuICAgIG1lc3NhZ2U6IHR5cGVzLkNoYXRNZXNzYWdlXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIGNvbnNvbGUubG9nKFwiPT0+dXBzZXJ0TWVzc2FnZT5cIiwgbWVzc2FnZS5pZCwgbWVzc2FnZSk7XG4gICAgYXdhaXQgdGhpcy5fbWVzc2FnZVN0b3JlLnNldChtZXNzYWdlLmlkLCBtZXNzYWdlKTtcbiAgfVxufVxuIl19