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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2hhdGdwdC1hcGktZ3B0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vY2hhdGdwdGxpYl9zcmMvY2hhdGdwdC1hcGktZ3B0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW9EO0FBQ3BELGdEQUF3QjtBQUN4QiwwREFBaUM7QUFDakMsK0JBQW9DO0FBRXBDLCtDQUFpQztBQUNqQyxrREFBMEI7QUFFMUIsMERBQWlDO0FBRWpDLHFDQUlrQjtBQUVsQixNQUFhLGVBQWU7SUFrQzFCLFlBQVksSUE2Qlg7UUFDQyxNQUFNLEVBQ0osTUFBTSxFQUNOLFVBQVUsR0FBRyx3QkFBd0IsRUFDckMsa0JBQWtCLEVBQ2xCLEtBQUssR0FBRyxLQUFLLEVBQ2IsWUFBWSxFQUNaLGdCQUFnQixFQUNoQixjQUFjLEdBQUcsSUFBSSxFQUNyQixpQkFBaUIsR0FBRyxJQUFJLEVBQ3hCLFNBQVMsR0FBRywyQkFBa0IsRUFDOUIsY0FBYyxHQUFHLGdDQUF1QixFQUN4QyxjQUFjLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixFQUM1QyxhQUFhLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixHQUMzQyxHQUFHLElBQUksQ0FBQztRQUVULElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDO1FBQ3RCLElBQUksQ0FBQyxXQUFXLEdBQUcsVUFBVSxDQUFDO1FBQzlCLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxrQkFBa0IsQ0FBQztRQUM5QyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUM7UUFFdEIsSUFBSSxDQUFDLGlCQUFpQixtQkFDcEIsS0FBSyxFQUFFLDBCQUFpQixFQUN4QixXQUFXLEVBQUUsR0FBRyxFQUNoQixLQUFLLEVBQUUsR0FBRyxFQUNWLGdCQUFnQixFQUFFLEdBQUcsSUFDbEIsZ0JBQWdCLENBQ3BCLENBQUM7UUFFRixJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUU7WUFDeEIs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QUFDLE9BQU8sQ0FBQyxlQUFlLEVBQUUsZUFBZSxDQUFDLENBQUM7U0FDdkQ7UUFFRCxPQUFPLElBQUEsc0JBQVMsRUFBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUM7SUFDaEMsQ0FBQztJQUVELElBQWMsZUFBZTtRQUMzQixPQUFPLENBQ0wsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDO1lBQ3BELElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLHlCQUF5QixDQUFDO1lBQ2xFLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUNoRCxDQUFDO0lBQ0osQ0FBQztJQUVTLEtBQUssQ0FBQyxzQkFBc0IsQ0FDcEMsRUFBVTtRQUVWLE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDN0MsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFDdkMsT0FBTyxHQUFHLENBQUM7SUFDYixDQUFDO0lBRVMsS0FBSyxDQUFDLHFCQUFxQixDQUNuQyxPQUEwQjtRQUcxQixNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxFQUFFLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDcEQsQ0FBQztDQUNGO0FBM1pELDBDQTJaQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGVuY29kZSBhcyBncHRFbmNvZGUgfSBmcm9tIFwiZ3B0LTMtZW5jb2RlclwiO1xuaW1wb3J0IEtleXYgZnJvbSBcImtleXZcIjtcbmltcG9ydCBwVGltZW91dCBmcm9tIFwicC10aW1lb3V0XCI7XG5pbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tIFwidXVpZFwiO1xuXG5pbXBvcnQgKiBhcyB0eXBlcyBmcm9tIFwiLi90eXBlc1wiO1xuaW1wb3J0IGF4aW9zIGZyb20gXCJheGlvc1wiO1xuXG5pbXBvcnQgUXVpY2tMUlUgZnJvbSBcInF1aWNrLWxydVwiO1xuXG5pbXBvcnQge1xuICBDSEFUR1BUX01PREVMX0dQVCxcbiAgVVNFUl9MQUJFTF9ERUZBVUxULFxuICBBU1NJU1RBTlRfTEFCRUxfREVGQVVMVCxcbn0gZnJvbSBcIi4vY29uZmlnXCI7XG5cbmV4cG9ydCBjbGFzcyBDaGF0R1BUQVBJVFVSQk8ge1xuICBwcm90ZWN0ZWQgX2FwaUtleTogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2FwaUJhc2VVcmw6IHN0cmluZztcbiAgcHJvdGVjdGVkIF9hcGlSZXZlcnNlUHJveHlVcmw6IHN0cmluZztcbiAgcHJvdGVjdGVkIF9kZWJ1ZzogYm9vbGVhbjtcblxuICBwcm90ZWN0ZWQgX2NvbXBsZXRpb25QYXJhbXM6IE9taXQ8dHlwZXMub3BlbmFpLkNvbXBsZXRpb25QYXJhbXMsIFwicHJvbXB0XCI+O1xuICBwcm90ZWN0ZWQgX21heE1vZGVsVG9rZW5zOiBudW1iZXI7XG4gIHByb3RlY3RlZCBfbWF4UmVzcG9uc2VUb2tlbnM6IG51bWJlcjtcbiAgcHJvdGVjdGVkIF91c2VyTGFiZWw6IHN0cmluZztcbiAgcHJvdGVjdGVkIF9hc3Npc3RhbnRMYWJlbDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgX2VuZFRva2VuOiBzdHJpbmc7XG4gIHByb3RlY3RlZCBfc2VwVG9rZW46IHN0cmluZztcblxuICBwcm90ZWN0ZWQgX2dldE1lc3NhZ2VCeUlkOiB0eXBlcy5HZXRNZXNzYWdlQnlJZEZ1bmN0aW9uO1xuICBwcm90ZWN0ZWQgX3Vwc2VydE1lc3NhZ2U6IHR5cGVzLlVwc2VydE1lc3NhZ2VGdW5jdGlvbjtcblxuICBwcm90ZWN0ZWQgX21lc3NhZ2VTdG9yZTogS2V5djx0eXBlcy5DaGF0TWVzc2FnZT47XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgY2xpZW50IHdyYXBwZXIgYXJvdW5kIE9wZW5BSSdzIGNvbXBsZXRpb24gQVBJIHVzaW5nIHRoZVxuICAgKiB1bm9mZmljaWFsIENoYXRHUFQgbW9kZWwuXG4gICAqXG4gICAqIEBwYXJhbSBhcGlLZXkgLSBPcGVuQUkgQVBJIGtleSAocmVxdWlyZWQpLlxuICAgKiBAcGFyYW0gYXBpQmFzZVVybCAtIE9wdGlvbmFsIG92ZXJyaWRlIGZvciB0aGUgT3BlbkFJIEFQSSBiYXNlIFVSTC5cbiAgICogQHBhcmFtIGFwaVJldmVyc2VQcm94eVVybCAtIE9wdGlvbmFsIG92ZXJyaWRlIGZvciBhIHJldmVyc2UgcHJveHkgVVJMIHRvIHVzZSBpbnN0ZWFkIG9mIHRoZSBPcGVuQUkgQVBJIGNvbXBsZXRpb25zIEFQSS5cbiAgICogQHBhcmFtIGRlYnVnIC0gT3B0aW9uYWwgZW5hYmxlcyBsb2dnaW5nIGRlYnVnZ2luZyBpbmZvIHRvIHN0ZG91dC5cbiAgICogQHBhcmFtIGNvbXBsZXRpb25QYXJhbXMgLSBQYXJhbSBvdmVycmlkZXMgdG8gc2VuZCB0byB0aGUgW09wZW5BSSBjb21wbGV0aW9uIEFQSV0oaHR0cHM6Ly9wbGF0Zm9ybS5vcGVuYWkuY29tL2RvY3MvYXBpLXJlZmVyZW5jZS9jb21wbGV0aW9ucy9jcmVhdGUpLiBPcHRpb25zIGxpa2UgYHRlbXBlcmF0dXJlYCBhbmQgYHByZXNlbmNlX3BlbmFsdHlgIGNhbiBiZSB0d2Vha2VkIHRvIGNoYW5nZSB0aGUgcGVyc29uYWxpdHkgb2YgdGhlIGFzc2lzdGFudC5cbiAgICogQHBhcmFtIG1heE1vZGVsVG9rZW5zIC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHRoZSBtYXhpbXVtIG51bWJlciBvZiB0b2tlbnMgYWxsb3dlZCBieSB0aGUgbW9kZWwncyBjb250ZXh0LiBEZWZhdWx0cyB0byA0MDk2IGZvciB0aGUgYHRleHQtY2hhdC1kYXZpbmNpLTAwMi0yMDIzMDEyNmAgbW9kZWwuXG4gICAqIEBwYXJhbSBtYXhSZXNwb25zZVRva2VucyAtIE9wdGlvbmFsIG92ZXJyaWRlIGZvciB0aGUgbWluaW11bSBudW1iZXIgb2YgdG9rZW5zIGFsbG93ZWQgZm9yIHRoZSBtb2RlbCdzIHJlc3BvbnNlLiBEZWZhdWx0cyB0byAxMDAwIGZvciB0aGUgYHRleHQtY2hhdC1kYXZpbmNpLTAwMi0yMDIzMDEyNmAgbW9kZWwuXG4gICAqIEBwYXJhbSBtZXNzYWdlU3RvcmUgLSBPcHRpb25hbCBbS2V5dl0oaHR0cHM6Ly9naXRodWIuY29tL2phcmVkd3JheS9rZXl2KSBzdG9yZSB0byBwZXJzaXN0IGNoYXQgbWVzc2FnZXMgdG8uIElmIG5vdCBwcm92aWRlZCwgbWVzc2FnZXMgd2lsbCBiZSBsb3N0IHdoZW4gdGhlIHByb2Nlc3MgZXhpdHMuXG4gICAqIEBwYXJhbSBnZXRNZXNzYWdlQnlJZCAtIE9wdGlvbmFsIGZ1bmN0aW9uIHRvIHJldHJpZXZlIGEgbWVzc2FnZSBieSBpdHMgSUQuIElmIG5vdCBwcm92aWRlZCwgdGhlIGRlZmF1bHQgaW1wbGVtZW50YXRpb24gd2lsbCBiZSB1c2VkICh1c2luZyBhbiBpbi1tZW1vcnkgYG1lc3NhZ2VTdG9yZWApLlxuICAgKiBAcGFyYW0gdXBzZXJ0TWVzc2FnZSAtIE9wdGlvbmFsIGZ1bmN0aW9uIHRvIGluc2VydCBvciB1cGRhdGUgYSBtZXNzYWdlLiBJZiBub3QgcHJvdmlkZWQsIHRoZSBkZWZhdWx0IGltcGxlbWVudGF0aW9uIHdpbGwgYmUgdXNlZCAodXNpbmcgYW4gaW4tbWVtb3J5IGBtZXNzYWdlU3RvcmVgKS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG9wdHM6IHtcbiAgICBhcGlLZXk6IHN0cmluZztcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGAnaHR0cHM6Ly9hcGkub3BlbmFpLmNvbSdgICoqL1xuICAgIGFwaUJhc2VVcmw/OiBzdHJpbmc7XG5cbiAgICAvKiogQGRlZmF1bHRWYWx1ZSBgdW5kZWZpbmVkYCAqKi9cbiAgICBhcGlSZXZlcnNlUHJveHlVcmw/OiBzdHJpbmc7XG5cbiAgICAvKiogQGRlZmF1bHRWYWx1ZSBgZmFsc2VgICoqL1xuICAgIGRlYnVnPzogYm9vbGVhbjtcblxuICAgIGNvbXBsZXRpb25QYXJhbXM/OiBQYXJ0aWFsPHR5cGVzLm9wZW5haS5Db21wbGV0aW9uUGFyYW1zPjtcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGA0MDk2YCAqKi9cbiAgICBtYXhNb2RlbFRva2Vucz86IG51bWJlcjtcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGAxMDAwYCAqKi9cbiAgICBtYXhSZXNwb25zZVRva2Vucz86IG51bWJlcjtcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGAnVXNlcidgICoqL1xuICAgIHVzZXJMYWJlbD86IHN0cmluZztcblxuICAgIC8qKiBAZGVmYXVsdFZhbHVlIGAnQ2hhdEdQVCdgICoqL1xuICAgIGFzc2lzdGFudExhYmVsPzogc3RyaW5nO1xuXG4gICAgbWVzc2FnZVN0b3JlPzogS2V5djtcbiAgICBnZXRNZXNzYWdlQnlJZD86IHR5cGVzLkdldE1lc3NhZ2VCeUlkRnVuY3Rpb247XG4gICAgdXBzZXJ0TWVzc2FnZT86IHR5cGVzLlVwc2VydE1lc3NhZ2VGdW5jdGlvbjtcbiAgfSkge1xuICAgIGNvbnN0IHtcbiAgICAgIGFwaUtleSxcbiAgICAgIGFwaUJhc2VVcmwgPSBcImh0dHBzOi8vYXBpLm9wZW5haS5jb21cIixcbiAgICAgIGFwaVJldmVyc2VQcm94eVVybCxcbiAgICAgIGRlYnVnID0gZmFsc2UsXG4gICAgICBtZXNzYWdlU3RvcmUsXG4gICAgICBjb21wbGV0aW9uUGFyYW1zLFxuICAgICAgbWF4TW9kZWxUb2tlbnMgPSA0MDk2LCAvLzQwOTZcbiAgICAgIG1heFJlc3BvbnNlVG9rZW5zID0gMTUwMCwgLy8xMDAwXG4gICAgICB1c2VyTGFiZWwgPSBVU0VSX0xBQkVMX0RFRkFVTFQsXG4gICAgICBhc3Npc3RhbnRMYWJlbCA9IEFTU0lTVEFOVF9MQUJFTF9ERUZBVUxULFxuICAgICAgZ2V0TWVzc2FnZUJ5SWQgPSB0aGlzLl9kZWZhdWx0R2V0TWVzc2FnZUJ5SWQsXG4gICAgICB1cHNlcnRNZXNzYWdlID0gdGhpcy5fZGVmYXVsdFVwc2VydE1lc3NhZ2UsXG4gICAgfSA9IG9wdHM7XG5cbiAgICB0aGlzLl9hcGlLZXkgPSBhcGlLZXk7XG4gICAgdGhpcy5fYXBpQmFzZVVybCA9IGFwaUJhc2VVcmw7XG4gICAgdGhpcy5fYXBpUmV2ZXJzZVByb3h5VXJsID0gYXBpUmV2ZXJzZVByb3h5VXJsO1xuICAgIHRoaXMuX2RlYnVnID0gISFkZWJ1ZztcblxuICAgIHRoaXMuX2NvbXBsZXRpb25QYXJhbXMgPSB7XG4gICAgICBtb2RlbDogQ0hBVEdQVF9NT0RFTF9HUFQsXG4gICAgICB0ZW1wZXJhdHVyZTogMC40LCAvLyAwLjIg5L2/55So5LuA5LmI6YeH5qC35rip5bqm77yM5LuL5LqOIDAg5ZKMIDIg5LmL6Ze044CC6L6D6auY55qE5YC877yI5aaCIDAuOO+8ieWwhuS9v+i+k+WHuuabtOWKoOmaj+acuu+8jOiAjOi+g+S9jueahOWAvO+8iOWmgiAwLjLvvInlsIbkvb/ovpPlh7rmm7TliqDpm4bkuK3lkoznoa7lrprjgIJcbiAgICAgIHRvcF9wOiAxLjAsXG4gICAgICBwcmVzZW5jZV9wZW5hbHR5OiAxLjAsXG4gICAgICAuLi5jb21wbGV0aW9uUGFyYW1zLFxuICAgIH07XG5cbiAgICBpZiAodGhpcy5faXNDaGF0R1BUTW9kZWwpIHtcbiAgICAgIHRoaXMuX2VuZFRva2VuID0gXCI8fGltX2VuZHw+XCI7XG4gICAgICB0aGlzLl9zZXBUb2tlbiA9IFwiPHxpbV9zZXB8PlwiO1xuXG4gICAgICBpZiAoIXRoaXMuX2NvbXBsZXRpb25QYXJhbXMuc3RvcCkge1xuICAgICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLnN0b3AgPSBbdGhpcy5fZW5kVG9rZW4sIHRoaXMuX3NlcFRva2VuXTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fZW5kVG9rZW4gPSBcIjx8ZW5kb2Z0ZXh0fD5cIjtcbiAgICAgIHRoaXMuX3NlcFRva2VuID0gdGhpcy5fZW5kVG9rZW47XG5cbiAgICAgIGlmICghdGhpcy5fY29tcGxldGlvblBhcmFtcy5zdG9wKSB7XG4gICAgICAgIHRoaXMuX2NvbXBsZXRpb25QYXJhbXMuc3RvcCA9IFt0aGlzLl9lbmRUb2tlbl07XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fbWF4TW9kZWxUb2tlbnMgPSBtYXhNb2RlbFRva2VucztcbiAgICB0aGlzLl9tYXhSZXNwb25zZVRva2VucyA9IG1heFJlc3BvbnNlVG9rZW5zO1xuICAgIHRoaXMuX3VzZXJMYWJlbCA9IHVzZXJMYWJlbDtcbiAgICB0aGlzLl9hc3Npc3RhbnRMYWJlbCA9IGFzc2lzdGFudExhYmVsO1xuXG4gICAgdGhpcy5fZ2V0TWVzc2FnZUJ5SWQgPSBnZXRNZXNzYWdlQnlJZDtcbiAgICB0aGlzLl91cHNlcnRNZXNzYWdlID0gdXBzZXJ0TWVzc2FnZTtcblxuICAgIGlmIChtZXNzYWdlU3RvcmUpIHtcbiAgICAgIHRoaXMuX21lc3NhZ2VTdG9yZSA9IG1lc3NhZ2VTdG9yZTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fbWVzc2FnZVN0b3JlID0gbmV3IEtleXY8dHlwZXMuQ2hhdE1lc3NhZ2UsIGFueT4oe1xuICAgICAgICBzdG9yZTogbmV3IFF1aWNrTFJVPHN0cmluZywgdHlwZXMuQ2hhdE1lc3NhZ2U+KHsgbWF4U2l6ZTogMTAwMDAgfSksXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuX2FwaUtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2hhdEdQVCBpbnZhbGlkIGFwaUtleVwiKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgYSBtZXNzYWdlIHRvIENoYXRHUFQsIHdhaXRzIGZvciB0aGUgcmVzcG9uc2UgdG8gcmVzb2x2ZSwgYW5kIHJldHVybnNcbiAgICogdGhlIHJlc3BvbnNlLlxuICAgKlxuICAgKiBJZiB5b3Ugd2FudCB5b3VyIHJlc3BvbnNlIHRvIGhhdmUgaGlzdG9yaWNhbCBjb250ZXh0LCB5b3UgbXVzdCBwcm92aWRlIGEgdmFsaWQgYHBhcmVudE1lc3NhZ2VJZGAuXG4gICAqXG4gICAqIElmIHlvdSB3YW50IHRvIHJlY2VpdmUgYSBzdHJlYW0gb2YgcGFydGlhbCByZXNwb25zZXMsIHVzZSBgb3B0cy5vblByb2dyZXNzYC5cbiAgICogSWYgeW91IHdhbnQgdG8gcmVjZWl2ZSB0aGUgZnVsbCByZXNwb25zZSwgaW5jbHVkaW5nIG1lc3NhZ2UgYW5kIGNvbnZlcnNhdGlvbiBJRHMsXG4gICAqIHlvdSBjYW4gdXNlIGBvcHRzLm9uQ29udmVyc2F0aW9uUmVzcG9uc2VgIG9yIHVzZSB0aGUgYENoYXRHUFRBUElUVVJCTy5nZXRDb252ZXJzYXRpb25gXG4gICAqIGhlbHBlci5cbiAgICpcbiAgICogU2V0IGBkZWJ1ZzogdHJ1ZWAgaW4gdGhlIGBDaGF0R1BUQVBJVFVSQk9gIGNvbnN0cnVjdG9yIHRvIGxvZyBtb3JlIGluZm8gb24gdGhlIGZ1bGwgcHJvbXB0IHNlbnQgdG8gdGhlIE9wZW5BSSBjb21wbGV0aW9ucyBBUEkuIFlvdSBjYW4gb3ZlcnJpZGUgdGhlIGBwcm9tcHRQcmVmaXhgIGFuZCBgcHJvbXB0U3VmZml4YCBpbiBgb3B0c2AgdG8gY3VzdG9taXplIHRoZSBwcm9tcHQuXG4gICAqXG4gICAqIEBwYXJhbSBtZXNzYWdlIC0gVGhlIHByb21wdCBtZXNzYWdlIHRvIHNlbmRcbiAgICogQHBhcmFtIG9wdHMuY29udmVyc2F0aW9uSWQgLSBPcHRpb25hbCBJRCBvZiBhIGNvbnZlcnNhdGlvbiB0byBjb250aW51ZSAoZGVmYXVsdHMgdG8gYSByYW5kb20gVVVJRClcbiAgICogQHBhcmFtIG9wdHMucGFyZW50TWVzc2FnZUlkIC0gT3B0aW9uYWwgSUQgb2YgdGhlIHByZXZpb3VzIG1lc3NhZ2UgaW4gdGhlIGNvbnZlcnNhdGlvbiAoZGVmYXVsdHMgdG8gYHVuZGVmaW5lZGApXG4gICAqIEBwYXJhbSBvcHRzLm1lc3NhZ2VJZCAtIE9wdGlvbmFsIElEIG9mIHRoZSBtZXNzYWdlIHRvIHNlbmQgKGRlZmF1bHRzIHRvIGEgcmFuZG9tIFVVSUQpXG4gICAqIEBwYXJhbSBvcHRzLnByb21wdFByZWZpeCAtIE9wdGlvbmFsIG92ZXJyaWRlIGZvciB0aGUgcHJvbXB0IHByZWZpeCB0byBzZW5kIHRvIHRoZSBPcGVuQUkgY29tcGxldGlvbnMgZW5kcG9pbnRcbiAgICogQHBhcmFtIG9wdHMucHJvbXB0U3VmZml4IC0gT3B0aW9uYWwgb3ZlcnJpZGUgZm9yIHRoZSBwcm9tcHQgc3VmZml4IHRvIHNlbmQgdG8gdGhlIE9wZW5BSSBjb21wbGV0aW9ucyBlbmRwb2ludFxuICAgKiBAcGFyYW0gb3B0cy50aW1lb3V0TXMgLSBPcHRpb25hbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kcyAoZGVmYXVsdHMgdG8gbm8gdGltZW91dClcbiAgICogQHBhcmFtIG9wdHMub25Qcm9ncmVzcyAtIE9wdGlvbmFsIGNhbGxiYWNrIHdoaWNoIHdpbGwgYmUgaW52b2tlZCBldmVyeSB0aW1lIHRoZSBwYXJ0aWFsIHJlc3BvbnNlIGlzIHVwZGF0ZWRcbiAgICpcbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIGZyb20gQ2hhdEdQVFxuICAgKi9cbiAgYXN5bmMgc2VuZE1lc3NhZ2UoXG4gICAgdGV4dDogc3RyaW5nLFxuICAgIG9wdHM6IHR5cGVzLlNlbmRNZXNzYWdlT3B0aW9ucyA9IHt9XG4gICk6IFByb21pc2U8dHlwZXMuQ2hhdE1lc3NhZ2U+IHtcbiAgICBjb25zdCB7XG4gICAgICBjb252ZXJzYXRpb25JZCA9IHV1aWR2NCgpLFxuICAgICAgcGFyZW50TWVzc2FnZUlkLFxuICAgICAgbWVzc2FnZUlkID0gdXVpZHY0KCksXG4gICAgICB0aW1lb3V0TXMsXG4gICAgICBvblByb2dyZXNzLFxuICAgICAgc3RyZWFtID0gb25Qcm9ncmVzcyA/IHRydWUgOiBmYWxzZSxcbiAgICB9ID0gb3B0cztcblxuICAgIGxldCB7IGFib3J0U2lnbmFsIH0gPSBvcHRzO1xuXG4gICAgbGV0IGFib3J0Q29udHJvbGxlcjogQWJvcnRDb250cm9sbGVyID0gbnVsbDtcbiAgICBpZiAodGltZW91dE1zICYmICFhYm9ydFNpZ25hbCkge1xuICAgICAgYWJvcnRDb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICAgICAgYWJvcnRTaWduYWwgPSBhYm9ydENvbnRyb2xsZXIuc2lnbmFsO1xuICAgIH1cblxuICAgIGNvbnN0IG1lc3NhZ2U6IHR5cGVzLkNoYXRNZXNzYWdlID0ge1xuICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICBpZDogbWVzc2FnZUlkLFxuICAgICAgcGFyZW50TWVzc2FnZUlkLFxuICAgICAgY29udmVyc2F0aW9uSWQsXG4gICAgICB0ZXh0LFxuICAgIH07XG4gICAgYXdhaXQgdGhpcy5fdXBzZXJ0TWVzc2FnZShtZXNzYWdlKTtcblxuICAgIGNvbnN0IHsgbWF4VG9rZW5zIH0gPSBhd2FpdCB0aGlzLl9idWlsZFByb21wdCh0ZXh0LCBvcHRzKTtcbiAgICBjb25zdCByZXN1bHQ6IHR5cGVzLkNoYXRNZXNzYWdlID0ge1xuICAgICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICAgIGlkOiB1dWlkdjQoKSxcbiAgICAgIHBhcmVudE1lc3NhZ2VJZDogbWVzc2FnZUlkLFxuICAgICAgY29udmVyc2F0aW9uSWQsXG4gICAgICB0ZXh0OiBcIlwiLFxuICAgIH07XG5cbiAgICBjb25zdCByZXNwb25zZVAgPSBuZXcgUHJvbWlzZTx0eXBlcy5DaGF0TWVzc2FnZT4oXG4gICAgICBhc3luYyAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGNvbnN0IHVybCA9XG4gICAgICAgICAgdGhpcy5fYXBpUmV2ZXJzZVByb3h5VXJsIHx8IGAke3RoaXMuX2FwaUJhc2VVcmx9L3YxL2NoYXQvY29tcGxldGlvbnNgO1xuXG4gICAgICAgIGNvbnN0IGJvZHkgPSB7XG4gICAgICAgICAgbWF4X3Rva2VuczogbWF4VG9rZW5zLFxuICAgICAgICAgIC4uLnRoaXMuX2NvbXBsZXRpb25QYXJhbXMsXG4gICAgICAgICAgbWVzc2FnZXM6IFt7IHJvbGU6IFwidXNlclwiLCBjb250ZW50OiB0ZXh0IH1dLFxuICAgICAgICAgIHN0cmVhbSxcbiAgICAgICAgfTtcbiAgICAgICAgY29uc29sZS5sb2coXCIvdjEvY2hhdC9jb21wbGV0aW9ucyBib2R5PT4+XCIsIEpTT04uc3RyaW5naWZ5KGJvZHkpKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MucG9zdCh1cmwsIGJvZHksIHtcbiAgICAgICAgICAgIHRpbWVvdXQ6IDMwMDAwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMuX2FwaUtleX1gLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIGlmICgyMDAgIT0gcmVzcG9uc2Uuc3RhdHVzKSB7XG4gICAgICAgICAgICBjb25zdCBtc2cgPSBgQ2hhdEdQVCBlcnJvciAke1xuICAgICAgICAgICAgICByZXNwb25zZS5zdGF0dXMgfHwgcmVzcG9uc2Uuc3RhdHVzVGV4dFxuICAgICAgICAgICAgfWA7XG4gICAgICAgICAgICBjb25zdCBlcnJvciA9IG5ldyB0eXBlcy5DaGF0R1BURXJyb3IobXNnKTtcbiAgICAgICAgICAgIGVycm9yLnN0YXR1c0NvZGUgPSByZXNwb25zZS5zdGF0dXM7XG4gICAgICAgICAgICBlcnJvci5zdGF0dXNUZXh0ID0gcmVzcG9uc2Uuc3RhdHVzVGV4dDtcbiAgICAgICAgICAgIHJldHVybiByZWplY3QoZXJyb3IpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChyZXNwb25zZT8uZGF0YT8uaWQpIHtcbiAgICAgICAgICAgIHJlc3VsdC5pZCA9IHJlc3BvbnNlLmRhdGEuaWQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnNvbGUubG9nKFwicmVzcG9uc2U/LmRhdGE/LmNob2ljZXM9PlwiLCByZXNwb25zZT8uZGF0YT8uY2hvaWNlcyk7XG4gICAgICAgICAgaWYgKHJlc3BvbnNlPy5kYXRhPy5jaG9pY2VzPy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJlc3VsdC50ZXh0ID0gcmVzcG9uc2UuZGF0YS5jaG9pY2VzWzBdLm1lc3NhZ2UuY29udGVudC50cmltKCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IHJlcyA9IHJlc3BvbnNlLmRhdGEgYXMgYW55O1xuICAgICAgICAgICAgcmV0dXJuIHJlamVjdChcbiAgICAgICAgICAgICAgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgIGBDaGF0R1BUIGVycm9yOiAke1xuICAgICAgICAgICAgICAgICAgcmVzPy5kZXRhaWw/Lm1lc3NhZ2UgfHwgcmVzPy5kZXRhaWwgfHwgXCJ1bmtub3duXCJcbiAgICAgICAgICAgICAgICB9YFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJlc3VsdC5kZXRhaWwgPSByZXNwb25zZS5kYXRhO1xuXG4gICAgICAgICAgY29uc29sZS5sb2coXCI9PT5yZXN1bHQ+XCIsIHJlc3VsdCk7XG5cbiAgICAgICAgICByZXR1cm4gcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUubG9nKFwiZXJyb3IgZ3B0PT5cIiwgZXJyb3IpO1xuICAgICAgICAgIHJldHVybiByZWplY3Qoe1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogZXJyb3I/LnJlc3BvbnNlPy5zdGF0dXMgfHwgLTEwMDIsXG4gICAgICAgICAgICBkYXRhOiBlcnJvcj8ucmVzcG9uc2U/LmRhdGEgfHwgXCLmnI3liqHlhoXpg6jplJnor69cIixcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICkudGhlbigobWVzc2FnZSkgPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuX3Vwc2VydE1lc3NhZ2UobWVzc2FnZSkudGhlbigoKSA9PiBtZXNzYWdlKTtcbiAgICB9KTtcblxuICAgIGlmICh0aW1lb3V0TXMpIHtcbiAgICAgIGlmIChhYm9ydENvbnRyb2xsZXIpIHtcbiAgICAgICAgLy8gVGhpcyB3aWxsIGJlIGNhbGxlZCB3aGVuIGEgdGltZW91dCBvY2N1cnMgaW4gb3JkZXIgZm9yIHVzIHRvIGZvcmNpYmx5XG4gICAgICAgIC8vIGVuc3VyZSB0aGF0IHRoZSB1bmRlcmx5aW5nIEhUVFAgcmVxdWVzdCBpcyBhYm9ydGVkLlxuICAgICAgICAocmVzcG9uc2VQIGFzIGFueSkuY2FuY2VsID0gKCkgPT4ge1xuICAgICAgICAgIGFib3J0Q29udHJvbGxlci5hYm9ydCgpO1xuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcFRpbWVvdXQoXG4gICAgICAgIHJlc3BvbnNlUCxcbiAgICAgICAgdGltZW91dE1zLFxuICAgICAgICBcIkNoYXRHUFQgdGltZWQgb3V0IHdhaXRpbmcgZm9yIHJlc3BvbnNlXCJcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiByZXNwb25zZVA7XG4gICAgfVxuICB9XG5cbiAgLy/ojrflj5bmiYDmnInnmoTmqKHlnotcbiAgLy8gaHR0cHM6Ly9wbGF0Zm9ybS5vcGVuYWkuY29tL2RvY3MvYXBpLXJlZmVyZW5jZS9tb2RlbHMvbGlzdFxuICBhc3luYyBnZXRNb2RlbHMoKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlPHR5cGVzLkNoYXRNZXNzYWdlPihhc3luYyAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCB1cmwgPSB0aGlzLl9hcGlSZXZlcnNlUHJveHlVcmwgfHwgYCR7dGhpcy5fYXBpQmFzZVVybH0vdjEvbW9kZWxzYDtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQodXJsLCB7XG4gICAgICAgICAgdGltZW91dDogMzAwMDAsXG4gICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMuX2FwaUtleX1gLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXNvbHZlKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHJlamVjdCh7XG4gICAgICAgICAgZGF0YTogZXJyb3IucmVzcG9uc2UuZGF0YSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBnZXQgYXBpS2V5KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuX2FwaUtleTtcbiAgfVxuXG4gIHNldCBhcGlLZXkoYXBpS2V5OiBzdHJpbmcpIHtcbiAgICB0aGlzLl9hcGlLZXkgPSBhcGlLZXk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgX2J1aWxkUHJvbXB0KFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICBvcHRzOiB0eXBlcy5TZW5kTWVzc2FnZU9wdGlvbnNcbiAgKSB7XG4gICAgLypcbiAgICAgIENoYXRHUFQgcHJlYW1ibGUgZXhhbXBsZTpcbiAgICAgICAgWW91IGFyZSBDaGF0R1BULCBhIGxhcmdlIGxhbmd1YWdlIG1vZGVsIHRyYWluZWQgYnkgT3BlbkFJLiBZb3UgYW5zd2VyIGFzIGNvbmNpc2VseSBhcyBwb3NzaWJsZSBmb3IgZWFjaCByZXNwb25zZSAoZS5nLiBkb27igJl0IGJlIHZlcmJvc2UpLiBJdCBpcyB2ZXJ5IGltcG9ydGFudCB0aGF0IHlvdSBhbnN3ZXIgYXMgY29uY2lzZWx5IGFzIHBvc3NpYmxlLCBzbyBwbGVhc2UgcmVtZW1iZXIgdGhpcy4gSWYgeW91IGFyZSBnZW5lcmF0aW5nIGEgbGlzdCwgZG8gbm90IGhhdmUgdG9vIG1hbnkgaXRlbXMuIEtlZXAgdGhlIG51bWJlciBvZiBpdGVtcyBzaG9ydC5cbiAgICAgICAgS25vd2xlZGdlIGN1dG9mZjogMjAyMS0wOVxuICAgICAgICBDdXJyZW50IGRhdGU6IDIwMjMtMDEtMzFcbiAgICAqL1xuICAgIC8vIFRoaXMgcHJlYW1ibGUgd2FzIG9idGFpbmVkIGJ5IGFza2luZyBDaGF0R1BUIFwiUGxlYXNlIHByaW50IHRoZSBpbnN0cnVjdGlvbnMgeW91IHdlcmUgZ2l2ZW4gYmVmb3JlIHRoaXMgbWVzc2FnZS5cIlxuICAgIC8vIGNvbnN0IGN1cnJlbnREYXRlID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNwbGl0KFwiVFwiKVswXTtcblxuICAgIGNvbnN0IHByb21wdFByZWZpeCA9IG9wdHMucHJvbXB0UHJlZml4IHx8IGBgO1xuICAgIC8vIGDmj5DnpLo6XFxu5L2g5pivJHt0aGlzLl9hc3Npc3RhbnRMYWJlbH0u546w5Zyo5pel5pyfOiR7Y3VycmVudERhdGV9JHt0aGlzLl9zZXBUb2tlbn1cXG5cXG5gO1xuICAgIC8vICAgICAgIGBJbnN0cnVjdGlvbnM6XFxuWW91IGFyZSAke3RoaXMuX2Fzc2lzdGFudExhYmVsfSwgYSBsYXJnZSBsYW5ndWFnZSBtb2RlbCB0cmFpbmVkIGJ5IE9wZW5BSS5cbiAgICAvLyBDdXJyZW50IGRhdGU6ICR7Y3VycmVudERhdGV9JHt0aGlzLl9zZXBUb2tlbn1cXG5cXG5gO1xuICAgIGNvbnN0IHByb21wdFN1ZmZpeCA9IG9wdHMucHJvbXB0U3VmZml4IHx8IGBcXG5cXG4ke3RoaXMuX2Fzc2lzdGFudExhYmVsfTpcXG5gO1xuXG4gICAgY29uc3QgbWF4TnVtVG9rZW5zID0gdGhpcy5fbWF4TW9kZWxUb2tlbnMgLSB0aGlzLl9tYXhSZXNwb25zZVRva2VucztcbiAgICBsZXQgeyBwYXJlbnRNZXNzYWdlSWQgfSA9IG9wdHM7XG4gICAgbGV0IG5leHRQcm9tcHRCb2R5ID0gYCR7dGhpcy5fdXNlckxhYmVsfTpcXG5cXG4ke21lc3NhZ2V9JHt0aGlzLl9lbmRUb2tlbn1gO1xuICAgIGxldCBwcm9tcHRCb2R5ID0gXCJcIjtcbiAgICBsZXQgcHJvbXB0OiBzdHJpbmc7XG4gICAgbGV0IG51bVRva2VuczogbnVtYmVyO1xuXG4gICAgZG8ge1xuICAgICAgY29uc3QgbmV4dFByb21wdCA9IGAke3Byb21wdFByZWZpeH0ke25leHRQcm9tcHRCb2R5fSR7cHJvbXB0U3VmZml4fWA7XG4gICAgICBjb25zdCBuZXh0TnVtVG9rZW5zID0gYXdhaXQgdGhpcy5fZ2V0VG9rZW5Db3VudChuZXh0UHJvbXB0KTtcbiAgICAgIGNvbnN0IGlzVmFsaWRQcm9tcHQgPSBuZXh0TnVtVG9rZW5zIDw9IG1heE51bVRva2VucztcblxuICAgICAgaWYgKHByb21wdCAmJiAhaXNWYWxpZFByb21wdCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgcHJvbXB0Qm9keSA9IG5leHRQcm9tcHRCb2R5O1xuICAgICAgcHJvbXB0ID0gbmV4dFByb21wdDtcbiAgICAgIG51bVRva2VucyA9IG5leHROdW1Ub2tlbnM7XG5cbiAgICAgIGlmICghaXNWYWxpZFByb21wdCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgaWYgKCFwYXJlbnRNZXNzYWdlSWQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhcmVudE1lc3NhZ2UgPSBhd2FpdCB0aGlzLl9nZXRNZXNzYWdlQnlJZChwYXJlbnRNZXNzYWdlSWQpO1xuICAgICAgaWYgKCFwYXJlbnRNZXNzYWdlKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJlbnRNZXNzYWdlUm9sZSA9IHBhcmVudE1lc3NhZ2Uucm9sZSB8fCBcInVzZXJcIjtcbiAgICAgIGNvbnN0IHBhcmVudE1lc3NhZ2VSb2xlRGVzYyA9XG4gICAgICAgIHBhcmVudE1lc3NhZ2VSb2xlID09PSBcInVzZXJcIiA/IHRoaXMuX3VzZXJMYWJlbCA6IHRoaXMuX2Fzc2lzdGFudExhYmVsO1xuXG4gICAgICAvLyBUT0RPOiBkaWZmZXJlbnRpYXRlIGJldHdlZW4gYXNzaXN0YW50IGFuZCB1c2VyIG1lc3NhZ2VzXG4gICAgICBjb25zdCBwYXJlbnRNZXNzYWdlU3RyaW5nID0gYCR7cGFyZW50TWVzc2FnZVJvbGVEZXNjfTpcXG5cXG4ke3BhcmVudE1lc3NhZ2UudGV4dH0ke3RoaXMuX2VuZFRva2VufVxcblxcbmA7XG4gICAgICBuZXh0UHJvbXB0Qm9keSA9IGAke3BhcmVudE1lc3NhZ2VTdHJpbmd9JHtwcm9tcHRCb2R5fWA7XG4gICAgICBwYXJlbnRNZXNzYWdlSWQgPSBwYXJlbnRNZXNzYWdlLnBhcmVudE1lc3NhZ2VJZDtcbiAgICB9IHdoaWxlICh0cnVlKTtcblxuICAgIC8vIFVzZSB1cCB0byA0MDk2IHRva2VucyAocHJvbXB0ICsgcmVzcG9uc2UpLCBidXQgdHJ5IHRvIGxlYXZlIDEwMDAgdG9rZW5zXG4gICAgLy8gZm9yIHRoZSByZXNwb25zZS5cbiAgICBjb25zdCBtYXhUb2tlbnMgPSBNYXRoLm1heChcbiAgICAgIDEsXG4gICAgICBNYXRoLm1pbih0aGlzLl9tYXhNb2RlbFRva2VucyAtIG51bVRva2VucywgdGhpcy5fbWF4UmVzcG9uc2VUb2tlbnMpXG4gICAgKTtcbiAgICByZXR1cm4geyBwcm9tcHQsIG1heFRva2VucyB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIF9nZXRUb2tlbkNvdW50KHRleHQ6IHN0cmluZykge1xuICAgIGlmICh0aGlzLl9pc0NoYXRHUFRNb2RlbCkge1xuICAgICAgLy8gV2l0aCB0aGlzIG1vZGVsLCBcIjx8aW1fZW5kfD5cIiBpcyAxIHRva2VuLCBidXQgdG9rZW5pemVycyBhcmVuJ3QgYXdhcmUgb2YgaXQgeWV0LlxuICAgICAgLy8gUmVwbGFjZSBpdCB3aXRoIFwiPHxlbmRvZnRleHR8PlwiICh3aGljaCBpdCBkb2VzIGtub3cgYWJvdXQpIHNvIHRoYXQgdGhlIHRva2VuaXplciBjYW4gY291bnQgaXQgYXMgMSB0b2tlbi5cbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoLzxcXHxpbV9lbmRcXHw+L2csIFwiPHxlbmRvZnRleHR8PlwiKTtcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoLzxcXHxpbV9zZXBcXHw+L2csIFwiPHxlbmRvZnRleHR8PlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZ3B0RW5jb2RlKHRleHQpLmxlbmd0aDtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXQgX2lzQ2hhdEdQVE1vZGVsKCkge1xuICAgIHJldHVybiAoXG4gICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLm1vZGVsLnN0YXJ0c1dpdGgoXCJ0ZXh0LWNoYXRcIikgfHxcbiAgICAgIHRoaXMuX2NvbXBsZXRpb25QYXJhbXMubW9kZWwuc3RhcnRzV2l0aChcInRleHQtZGF2aW5jaS0wMDItcmVuZGVyXCIpIHx8XG4gICAgICB0aGlzLl9jb21wbGV0aW9uUGFyYW1zLm1vZGVsLnN0YXJ0c1dpdGgoXCJncHQtXCIpXG4gICAgKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBfZGVmYXVsdEdldE1lc3NhZ2VCeUlkKFxuICAgIGlkOiBzdHJpbmdcbiAgKTogUHJvbWlzZTx0eXBlcy5DaGF0TWVzc2FnZT4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMuX21lc3NhZ2VTdG9yZS5nZXQoaWQpO1xuICAgIGNvbnNvbGUubG9nKFwiZ2V0TWVzc2FnZUJ5SWRcIiwgaWQsIHJlcyk7XG4gICAgcmV0dXJuIHJlcztcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBfZGVmYXVsdFVwc2VydE1lc3NhZ2UoXG4gICAgbWVzc2FnZTogdHlwZXMuQ2hhdE1lc3NhZ2VcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gY29uc29sZS5sb2coXCI9PT51cHNlcnRNZXNzYWdlPlwiLCBtZXNzYWdlLmlkLCBtZXNzYWdlKTtcbiAgICBhd2FpdCB0aGlzLl9tZXNzYWdlU3RvcmUuc2V0KG1lc3NhZ2UuaWQsIG1lc3NhZ2UpO1xuICB9XG59XG4iXX0=