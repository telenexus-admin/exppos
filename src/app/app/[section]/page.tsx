import { notFound } from "next/navigation";
import { SectionPage } from "@/components/section-page";
const sections=new Set(["branches","staff","customers","products","inventory","purchases","sales","invoices","accounting","reports","tasks","audit-logs","settings","notifications"]);
export default async function Page({params}:{params:Promise<{section:string}>}){const{section}=await params;if(!sections.has(section))notFound();return <SectionPage section={section}/>}
