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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.hashToken = hashToken;
const crypto = __importStar(require("crypto"));
const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters');
}
function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}
function decrypt(encryptedText) {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J5cHRvLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY3J5cHRvLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBU0EsMEJBY0M7QUFFRCwwQkFrQkM7QUFFRCw4QkFFQztBQS9DRCwrQ0FBaUM7QUFFakMsTUFBTSxTQUFTLEdBQUcsYUFBYSxDQUFDO0FBQ2hDLE1BQU0sY0FBYyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBYyxJQUFJLEVBQUUsQ0FBQztBQUV4RCxJQUFJLENBQUMsY0FBYyxJQUFJLGNBQWMsQ0FBQyxNQUFNLEtBQUssRUFBRSxFQUFFLENBQUM7SUFDbEQsTUFBTSxJQUFJLEtBQUssQ0FBQyw4Q0FBOEMsQ0FBQyxDQUFDO0FBQ3BFLENBQUM7QUFFRCxTQUFnQixPQUFPLENBQUMsSUFBWTtJQUNoQyxNQUFNLEVBQUUsR0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ2xDLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxjQUFjLENBQ2hDLFNBQVMsRUFDVCxNQUFNLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUMzQixFQUFFLENBQ0wsQ0FBQztJQUVGLElBQUksU0FBUyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQztJQUNuRCxTQUFTLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUVqQyxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsVUFBVSxFQUFFLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBRXBELE9BQU8sR0FBRyxFQUFFLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLE9BQU8sSUFBSSxTQUFTLEVBQUUsQ0FBQztBQUMzRCxDQUFDO0FBRUQsU0FBZ0IsT0FBTyxDQUFDLGFBQXFCO0lBQ3pDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsVUFBVSxFQUFFLFNBQVMsQ0FBQyxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7SUFFaEUsTUFBTSxFQUFFLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDckMsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFFL0MsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLGdCQUFnQixDQUNwQyxTQUFTLEVBQ1QsTUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsRUFDM0IsRUFBRSxDQUNMLENBQUM7SUFFRixRQUFRLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBRTdCLElBQUksU0FBUyxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQztJQUMxRCxTQUFTLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUVwQyxPQUFPLFNBQVMsQ0FBQztBQUNyQixDQUFDO0FBRUQsU0FBZ0IsU0FBUyxDQUFDLEtBQWE7SUFDbkMsT0FBTyxNQUFNLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDbkUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdjcnlwdG8nO1xyXG5cclxuY29uc3QgQUxHT1JJVEhNID0gJ2Flcy0yNTYtZ2NtJztcclxuY29uc3QgRU5DUllQVElPTl9LRVkgPSBwcm9jZXNzLmVudi5FTkNSWVBUSU9OX0tFWSB8fCAnJztcclxuXHJcbmlmICghRU5DUllQVElPTl9LRVkgfHwgRU5DUllQVElPTl9LRVkubGVuZ3RoICE9PSAzMikge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKCdFTkNSWVBUSU9OX0tFWSBtdXN0IGJlIGV4YWN0bHkgMzIgY2hhcmFjdGVycycpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZW5jcnlwdCh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgaXYgPSBjcnlwdG8ucmFuZG9tQnl0ZXMoMTYpO1xyXG4gICAgY29uc3QgY2lwaGVyID0gY3J5cHRvLmNyZWF0ZUNpcGhlcml2KFxyXG4gICAgICAgIEFMR09SSVRITSxcclxuICAgICAgICBCdWZmZXIuZnJvbShFTkNSWVBUSU9OX0tFWSksXHJcbiAgICAgICAgaXZcclxuICAgICk7XHJcblxyXG4gICAgbGV0IGVuY3J5cHRlZCA9IGNpcGhlci51cGRhdGUodGV4dCwgJ3V0ZjgnLCAnaGV4Jyk7XHJcbiAgICBlbmNyeXB0ZWQgKz0gY2lwaGVyLmZpbmFsKCdoZXgnKTtcclxuXHJcbiAgICBjb25zdCBhdXRoVGFnID0gY2lwaGVyLmdldEF1dGhUYWcoKS50b1N0cmluZygnaGV4Jyk7XHJcblxyXG4gICAgcmV0dXJuIGAke2l2LnRvU3RyaW5nKCdoZXgnKX06JHthdXRoVGFnfToke2VuY3J5cHRlZH1gO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZGVjcnlwdChlbmNyeXB0ZWRUZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgW2l2SGV4LCBhdXRoVGFnSGV4LCBlbmNyeXB0ZWRdID0gZW5jcnlwdGVkVGV4dC5zcGxpdCgnOicpO1xyXG5cclxuICAgIGNvbnN0IGl2ID0gQnVmZmVyLmZyb20oaXZIZXgsICdoZXgnKTtcclxuICAgIGNvbnN0IGF1dGhUYWcgPSBCdWZmZXIuZnJvbShhdXRoVGFnSGV4LCAnaGV4Jyk7XHJcblxyXG4gICAgY29uc3QgZGVjaXBoZXIgPSBjcnlwdG8uY3JlYXRlRGVjaXBoZXJpdihcclxuICAgICAgICBBTEdPUklUSE0sXHJcbiAgICAgICAgQnVmZmVyLmZyb20oRU5DUllQVElPTl9LRVkpLFxyXG4gICAgICAgIGl2XHJcbiAgICApO1xyXG5cclxuICAgIGRlY2lwaGVyLnNldEF1dGhUYWcoYXV0aFRhZyk7XHJcblxyXG4gICAgbGV0IGRlY3J5cHRlZCA9IGRlY2lwaGVyLnVwZGF0ZShlbmNyeXB0ZWQsICdoZXgnLCAndXRmOCcpO1xyXG4gICAgZGVjcnlwdGVkICs9IGRlY2lwaGVyLmZpbmFsKCd1dGY4Jyk7XHJcblxyXG4gICAgcmV0dXJuIGRlY3J5cHRlZDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGhhc2hUb2tlbih0b2tlbjogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIHJldHVybiBjcnlwdG8uY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKHRva2VuKS5kaWdlc3QoJ2hleCcpO1xyXG59Il19