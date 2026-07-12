import{NextResponse,type NextRequest}from"next/server";
export async function GET(req:NextRequest){const response=NextResponse.redirect(new URL("/login",req.url));for(const name of["tenant_session","tenant_refresh"])response.cookies.set(name,"",{httpOnly:true,expires:new Date(0),path:"/"});return response}
