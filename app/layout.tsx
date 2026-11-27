import type { Metadata } from "next";
import type { ReactNode } from "react";
import logo from "@/lib/pi-logo.svg";
import "./globals.css";

const icon: string = typeof logo === "string" ? logo : logo.src;

export const metadata: Metadata = {
	title: "pi harness",
	icons: { icon },
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN">
			<body>{children}</body>
		</html>
	);
}
