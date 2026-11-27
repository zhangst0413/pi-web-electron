// GET /api/config  读取配置；PUT /api/config 保存配置（body 为 Partial<Config>）。
// Next.js 的约定：app/api/**/route.ts 里导出的 GET/POST/PUT/DELETE 函数
// 就是这个路径下的 HTTP 处理器，类似 Python Web 框架里的 @app.route。
import { NextResponse } from "next/server";
import { errorText, readConfig, saveConfig } from "@/lib/harness";
import type { Config } from "@/lib/types";

// 禁止静态化，保证每次请求都读最新的文件内容。
export const dynamic = "force-dynamic";

/** 返回完整配置（含 apiKey，前端输入框用密码类型显示掩码）。 */
export async function GET() {
	return NextResponse.json(readConfig());
}

/** 局部更新配置：只传想改的字段即可。 */
export async function PUT(request: Request) {
	try {
		const patch = (await request.json()) as Partial<Config>;
		return NextResponse.json(await saveConfig(patch));
	} catch (error) {
		// 400 表示客户端提供了无效数据（例如模型不存在），错误信息直接给前端显示。
		return NextResponse.json({ error: errorText(error) }, { status: 400 });
	}
}
