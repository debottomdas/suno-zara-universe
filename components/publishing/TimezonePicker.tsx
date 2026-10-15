'use client';
import {useEffect,useMemo,useState} from 'react';
import zones from '@/utils/publishing/timezones.json';
import s from './Publishing.module.css';
export default function TimezonePicker({value,disabled,onSave,onDirty}:{value:string;disabled:boolean;onSave:(zone:string)=>Promise<void>;onDirty:(dirty:boolean)=>void}){
 const [search,setSearch]=useState(''),[choice,setChoice]=useState(value),[mounted,setMounted]=useState(false);
 useEffect(()=>setMounted(true),[]);
 useEffect(()=>setChoice(value),[value]);
 const options=useMemo(()=>{
  if(!mounted)return [];
  const names=new Intl.DisplayNames(['en'],{type:'region'});
  return [...zones.map(([country,zone])=>({zone,label:`${names.of(country)} · ${zone.split('/').slice(1).join(' / ').replaceAll('_',' ')} — ${zone}`})),{zone:'UTC',label:'Worldwide · Coordinated Universal Time (UTC)'}].sort((a,b)=>a.label.localeCompare(b.label));
 },[mounted]);
 const shown=options.filter(o=>o.zone===choice||o.label.toLowerCase().includes(search.toLowerCase()));
 return <fieldset className={s.timezonePicker} disabled={disabled}><legend>Publishing timezone</legend><p>{value?'Saved for your account and future plans.':'Choose your timezone once. We never infer it from your location.'}</p><div className={s.timezoneFields}><label>Find a country, city or timezone<input type="search" value={search} placeholder="Search, e.g. United Kingdom or Dhaka" onChange={e=>setSearch(e.target.value)}/></label><label>Country / city / timezone<select aria-label="Publishing timezone" value={choice} onChange={e=>{setChoice(e.target.value);onDirty(e.target.value!==value)}}><option value="">Choose a timezone…</option>{choice&&!options.some(o=>o.zone===choice)&&<option value={choice}>{choice}</option>}{shown.map(o=><option key={o.zone} value={o.zone}>{o.label}</option>)}</select></label><button type="button" disabled={!choice||choice===value} onClick={()=>void onSave(choice)}>Save timezone</button></div>{!shown.length&&mounted&&<p>No matching timezones. Try another city or country.</p>}<small>Changing this preference keeps draft dates and clock times, requiring a fresh review. Approved schedules remain unchanged.</small></fieldset>;
}
