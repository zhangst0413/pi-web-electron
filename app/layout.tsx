// app/layout.tsx —— 根布局（每个页面都会被包在这里）。
// 对应 Next.js 的约定：app/layout.tsx 必须导出默认组件，并渲染 <html> 与 <body>。
// 类似 Python Web 框架里的 base.html（母版页）。
import type { Metadata } from "next";
import type { ReactNode } from "react";
import logo from "@/lib/pi-logo.svg";
import "./globals.css";

// SVG 导入的两种形态（字符串路径或对象）都要兼容。
const icon: string = typeof logo === "string" ? logo : logo.src;

/** 页面标题与 favicon（浏览器标签图标）。 */
export const metadata: Metadata = {
	title: "pi harness",
	icons: { icon },
};

/** `children` 就是当前路由对应的页面（例如 app/page.tsx）。 */
export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN">
			<body>{children}</body>
		</html>
	);
}
