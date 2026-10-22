/** Shared, host-independent validation for the plugin's own metering records. */
export const NATIVE_SEARCH_USAGE_EVENT = 'cost-meter/native-search-usage'
import { validRequestFee, matchesRequestFeeModel } from './web-request-pricing.js'

export function isNativeSearchUsageEvent(event) {
  const data = event?.data
  return event?.type === NATIVE_SEARCH_USAGE_EVENT && data?.provider === 'deepseek-official'
    && typeof data.model === 'string' && /^deepseek-[a-z\d._:-]{1,120}$/i.test(data.model)
    && typeof data.requestId === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(data.requestId)
    && Number.isFinite(data.startedAtMs) && data.startedAtMs > 0
    && (data.requestFee === undefined || validRequestFee(data.requestFee, data.startedAtMs) && matchesRequestFeeModel(data.model, data.requestFee) && Object.values(data.usage ?? {}).every(value => value === 0))
    && (data.webSource === undefined || ['messages', 'search-api', 'fetch-api'].includes(data.webSource))
    && (data.webSelection === undefined || ['deepseek-official', 'deepseek-search-api', 'deepseek-fetch-api', 'http'].includes(data.webSelection))
    && ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].every(key => Number.isSafeInteger(data.usage?.[key]) && data.usage[key] >= 0)
}
