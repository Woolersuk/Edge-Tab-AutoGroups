
function nextPriority(){

 const groups=document.querySelectorAll(".group");

 return groups.length+1;
}

function createPattern(value=""){

 const div=document.createElement("div");
 div.className="pattern";

 div.innerHTML=`
 <input value="${value}" placeholder="*.visualstudio.com" size="50">
 <button class="removePattern">Remove</button>
 `;

 div.querySelector(".removePattern")
   .addEventListener("click",()=>div.remove());

 return div;
}

function createGroup(group={}){

 const div=document.createElement("div");
 div.className="group";

 div.innerHTML=`
 <h3>Group</h3>

 Name:
 <input class="groupName" value="${group.groupName||''}">

 Colour:
 <select class="colour">
   <option>blue</option>
   <option>green</option>
   <option>red</option>
   <option>yellow</option>
   <option>purple</option>
   <option>cyan</option>
   <option>orange</option>
   <option>grey</option>
 </select>

 Priority:
 <input class="priority" type="number"
 value="${group.priority||nextPriority()}">

 <div class="patterns"></div>

 <button class="addPattern">Add Pattern</button>
 <button class="deleteGroup">Delete Group</button>
 `;

 div.querySelector(".colour").value=group.colour||"blue";

 const patterns=div.querySelector(".patterns");

 (group.patterns||[""]).forEach(p=>{
   patterns.appendChild(createPattern(p));
 });

 div.querySelector(".addPattern")
   .addEventListener("click",()=>{
      patterns.appendChild(createPattern());
   });

 div.querySelector(".deleteGroup")
   .addEventListener("click",()=>div.remove());

 document.getElementById("groups")
   .appendChild(div);
}

async function load(){

 const r=await chrome.storage.sync.get("groups");

 (r.groups||[]).forEach(createGroup);
}

async function save(){

 const groups=[
   ...document.querySelectorAll(".group")
 ].map(g=>({
   groupName:g.querySelector(".groupName").value,
   colour:g.querySelector(".colour").value,
   priority:Number(
     g.querySelector(".priority").value
   ),
   patterns:[
     ...g.querySelectorAll(".pattern input")
   ]
   .map(x=>x.value)
   .filter(Boolean)
 }));

 await chrome.storage.sync.set({groups});

 alert("Groups saved");
}

document.getElementById("addGroup")
 .addEventListener("click",()=>createGroup());

document.getElementById("saveGroups")
 .addEventListener("click",save);

load();
