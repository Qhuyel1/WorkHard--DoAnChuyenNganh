import "./globals.css";
export const metadata={title:"WorkHard · Quản lý cửa hàng",description:"Bán hàng, nhập kho và quản lý công nợ cửa hàng."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="vi" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:`try{document.documentElement.dataset.theme=localStorage.getItem("workhard-theme")==="dark"?"dark":"light"}catch{document.documentElement.dataset.theme="light"}`}} /></head><body>{children}</body></html>}
