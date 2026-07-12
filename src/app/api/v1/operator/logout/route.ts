import { NextResponse, type NextRequest } from "next/server";
export async function GET(req:NextRequest){const response=NextResponse.redirect(new URL("/operator/login",req.url));response.cookies.set("operator_session","",{httpOnly:true,expires:new Date(0),path:"/"});return response}
