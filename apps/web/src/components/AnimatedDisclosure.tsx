import { useEffect, useRef, useState, type ReactNode } from "react";
export function AnimatedDisclosure({ open, children }: { open: boolean; children: ReactNode }) {
 const ref=useRef<HTMLDivElement>(null);
 const [settled,setSettled]=useState(open);
 useEffect(()=>{
  if(ref.current) ref.current.inert=!open;
  setSettled(false);
  const timer=setTimeout(()=>setSettled(open),260);
  return ()=>clearTimeout(timer);
 },[open]);
 return <div className={"sidebar-disclosure "+(open?"is-open ":"")+(open&&settled?"is-settled":"")} aria-hidden={!open} ref={ref}><div>{children}</div></div>;
}

