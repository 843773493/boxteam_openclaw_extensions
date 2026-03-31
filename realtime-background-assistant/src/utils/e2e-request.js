/**
 * 向本地 /chat 接口发送请求，并统一整理返回结果。
 *
 * 这个函数是通用的发送层，上层只需要提供 payload。
 * 它会把响应尽量解析成 JSON；如果服务端返回的是纯文本，
 * 就保留原文，方便直接看报错内容。
 */
export async function sendChatRequest(payload, options = {}) {
    const endpointUrl = options.endpointUrl ?? 'http://127.0.0.1:18189/chat';
    const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let parsedResponse = responseText;

    try {
        parsedResponse = JSON.parse(responseText);
    } catch {
        // 非 JSON 响应保留原文，便于排查接口错误。
    }

    return {
        status: response.status,
        ok: response.ok,
        response: parsedResponse,
    };
}