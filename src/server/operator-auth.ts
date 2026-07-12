import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { AppError } from "@/lib/errors";
export async function requireOperator(req:NextRequest){const token=req.cookies.get("operator_session")?.value;if(!token||!process.env.AUTH_SECRET)throw new AppError("UNAUTHENTICATED","Operator authentication required",401);try{const{payload}=await jwtVerify(token,new TextEncoder().encode(process.env.AUTH_SECRET),{algorithms:["HS256"]});if(payload.kind!=="operator"||!payload.sub)throw new Error();return{kind:"operator" as const,userId:payload.sub,requestId:req.headers.get("x-request-id")??crypto.randomUUID()}}catch{throw new AppError("UNAUTHENTICATED","Operator session is invalid or expired",401)}}
