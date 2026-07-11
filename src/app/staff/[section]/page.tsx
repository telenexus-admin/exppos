import { SectionPage } from "@/components/section-page";
export default async function Page({params}:{params:Promise<{section:string}>}){const{section}=await params;return <SectionPage section={section} basePath="/staff" role="Cashier"/>}
