"use client";
import { useState } from "react";
export function OperatorActionButton({label,success,danger=false}:{label:string;success:string;danger?:boolean}){const[message,setMessage]=useState("");function act(){if(danger&&!window.confirm(`Are you sure you want to ${label.toLowerCase()}?`))return;setMessage(success);window.setTimeout(()=>setMessage(""),5000)}return <span className="operator-action-wrap"><button type="button" className={danger?"danger":""} onClick={act}>{label}</button>{message&&<span className="operator-toast" role="status">✓ {message}</span>}</span>}
