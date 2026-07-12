import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError } from "@/server/http";
import { verifySecret } from "@/server/security/passwords";
import { signOperatorToken } from "@/server/security/tokens";
import { AppError } from "@/lib/errors";
const schema=z.object({email:z.string().email(),password:z.string().min(1)});
export async function POST(req:NextRequest){try{const input=schema.parse(await req.json());const user=await db.platformUser.findUnique({where:{email:input.email.toLowerCase()}});if(!user||user.status!=="ACTIVE"||!await verifySecret(user.passwordHash,input.password))throw new AppError("INVALID_CREDENTIALS","Invalid email or password",401);const token=await signOperatorToken(user.id);const response=NextResponse.json({ok:true});response.cookies.set("operator_session",token,{httpOnly:true,secure:process.env.APP_URL?.startsWith("https://")??false,sameSite:"strict",path:"/",maxAge:8*60*60});return response}catch(error){return apiError(error)}}
