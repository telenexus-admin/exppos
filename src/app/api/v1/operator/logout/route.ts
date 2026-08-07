import { NextResponse, type NextRequest } from "next/server";
import { publicUrl } from "@/server/public-url";
export async function GET(req:NextRequest){const response=NextResponse.redirect(publicUrl("/operator/login",req));response.cookies.set("operator_session","",{httpOnly:true,expires:new Date(0),path:"/"});return response}
