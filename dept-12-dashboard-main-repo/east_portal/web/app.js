(function () {
  "use strict";
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.js";

  var state = { data:null, order:null, original:null, pages:[], history:[], pen:true, note:"", submitting:false };
  var $ = function (id) { return document.getElementById(id); };

  function show(id) {
    ["unlockView","listView","orderView"].forEach(function (name) { $(name).hidden = name !== id; });
  }
  function toast(message) {
    $("toast").textContent = message; $("toast").classList.add("show");
    clearTimeout($("toast")._timer); $("toast")._timer = setTimeout(function () { $("toast").classList.remove("show"); }, 3000);
  }
  function request(url, options) {
    return fetch(url, options || {}).then(function (response) {
      if (response.status === 401) { show("unlockView"); throw new Error("Access code required"); }
      if (!response.ok) return response.json().then(function (j) { throw new Error(j.error || "Request failed"); });
      return response;
    });
  }
  function json(url, options) { return request(url, options).then(function (r) { return r.json(); }); }
  function orderCard(order, completed) {
    var button = document.createElement("button"); button.type = "button"; button.className = "order-card";
    var copy = document.createElement("div");
    var number = document.createElement("b"); number.textContent = order.solomon_order_no || "Order"; copy.appendChild(number);
    var detail = document.createElement("span");
    detail.textContent = [order.customer_name, order.city, order.state].filter(Boolean).join(" · ") +
      (completed && order.completed_truck ? " · Truck " + order.completed_truck : "");
    copy.appendChild(detail); button.appendChild(copy);
    var chev = document.createElement("span"); chev.className = "chevron"; chev.textContent = completed ? "✓" : "›"; button.appendChild(chev);
    if (!completed) button.onclick = function () { openOrder(order); };
    return button;
  }
  function renderList() {
    var ready = state.data.ready || [], completed = state.data.completed || [];
    $("scopeLabel").textContent = state.data.scope === "all" ? "Shared driver queue" : "Shared East Side queue";
    $("readyList").innerHTML = ""; $("completedList").innerHTML = "";
    $("listStatus").hidden = !!ready.length;
    $("listStatus").textContent = ready.length ? "" :
      (state.data.scope === "all" ? "No bag order receipts are ready." : "No East Side bag orders are ready.");
    ready.forEach(function (order) { $("readyList").appendChild(orderCard(order, false)); });
    completed.forEach(function (order) { $("completedList").appendChild(orderCard(order, true)); });
    $("completedSection").hidden = !completed.length;
    $("truckNumberList").innerHTML = (state.data.trucks || []).map(function (truck) {
      return '<option value="' + String(truck.number).replace(/"/g, "&quot;") + '"></option>';
    }).join("");
  }
  function load() {
    show("listView"); $("listStatus").hidden = false; $("listStatus").textContent = "Loading orders...";
    return json("/api/bootstrap").then(function (data) { state.data = data; renderList(); }).catch(function (err) {
      if (err.message !== "Access code required") { $("listStatus").textContent = err.message; toast(err.message); }
    });
  }
  function bytesFromBase64(value) {
    var raw = atob(value), bytes = new Uint8Array(raw.length);
    for (var i=0;i<raw.length;i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  function base64FromBytes(bytes) {
    var result = "", chunk = 0x8000;
    for (var i=0;i<bytes.length;i+=chunk) result += String.fromCharCode.apply(null, bytes.subarray(i,i+chunk));
    return btoa(result);
  }
  function openOrder(order) {
    state.order = order; state.original = null; state.pages = []; state.history = []; state.note = ""; state.pen = true;
    $("orderNumber").textContent = order.solomon_order_no || "Order";
    $("orderCustomer").textContent = [order.customer_name, order.city, order.state].filter(Boolean).join(" · ");
    $("noteButton").classList.remove("has-note"); $("penButton").classList.add("active");
    $("pages").innerHTML = ""; $("pdfStatus").hidden = false; $("pdfStatus").textContent = "Loading receipt...";
    show("orderView");
    request("/api/order/" + order.id + "/pdf").then(function (response) { return response.arrayBuffer(); })
      .then(function (buffer) {
        state.original = new Uint8Array(buffer);
        // PDF.js may transfer/detach the bytes it renders in its worker. Keep
        // the untouched source for pdf-lib when the driver completes the form.
        return renderPdf(state.original.slice());
      })
      .catch(function (err) { $("pdfStatus").hidden = false; $("pdfStatus").textContent = err.message; });
  }
  function renderPdf(bytes) {
    return pdfjsLib.getDocument({data:bytes}).promise.then(async function (pdf) {
      $("pages").innerHTML = ""; state.pages = []; state.history = [];
      var width = Math.min(document.documentElement.clientWidth - 20, 900);
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (var number=1; number<=pdf.numPages; number++) {
        var pdfPage = await pdf.getPage(number), natural = pdfPage.getViewport({scale:1});
        var viewport = pdfPage.getViewport({scale:width/natural.width});
        var cssW = Math.round(viewport.width), cssH = Math.round(viewport.height);
        var wrap = document.createElement("div"); wrap.className = "page"; wrap.style.width=cssW+"px"; wrap.style.height=cssH+"px";
        var base = document.createElement("canvas"), draw = document.createElement("canvas"); draw.className="draw-layer";
        [base,draw].forEach(function (canvas) { canvas.width=cssW*dpr; canvas.height=cssH*dpr; canvas.style.width=cssW+"px"; canvas.style.height=cssH+"px"; });
        wrap.appendChild(base); wrap.appendChild(draw); $("pages").appendChild(wrap);
        var baseContext=base.getContext("2d"); baseContext.scale(dpr,dpr); await pdfPage.render({canvasContext:baseContext,viewport:viewport}).promise;
        var drawContext=draw.getContext("2d"); drawContext.scale(dpr,dpr);
        var page={index:number-1,canvas:draw,ctx:drawContext,width:cssW,height:cssH,strokes:[]}; state.pages.push(page); bindDrawing(page);
      }
      $("pdfStatus").hidden = true;
    });
  }
  function point(page,event) { var rect=page.canvas.getBoundingClientRect(); return {x:event.clientX-rect.left,y:event.clientY-rect.top}; }
  function segment(ctx,a,b) { ctx.strokeStyle="#1c1c1e";ctx.lineWidth=3;ctx.lineCap="round";ctx.lineJoin="round";ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x+.01,b.y+.01);ctx.stroke(); }
  function bindDrawing(page) {
    var active=null;
    page.canvas.addEventListener("pointerdown",function(e){if(!state.pen||active)return;e.preventDefault();page.canvas.setPointerCapture(e.pointerId);active={id:e.pointerId,points:[point(page,e)]};});
    page.canvas.addEventListener("pointermove",function(e){if(!active||e.pointerId!==active.id)return;e.preventDefault();var next=point(page,e),prev=active.points[active.points.length-1];active.points.push(next);segment(page.ctx,prev,next);});
    function finish(e){if(!active||e.pointerId!==active.id)return;if(active.points.length===1)segment(page.ctx,active.points[0],active.points[0]);page.strokes.push(active);state.history.push({page:page,stroke:active});active=null;}
    page.canvas.addEventListener("pointerup",finish);page.canvas.addEventListener("pointercancel",finish);
  }
  function redraw(page) { page.ctx.clearRect(0,0,page.width,page.height);page.strokes.forEach(function(s){for(var i=1;i<s.points.length;i++)segment(page.ctx,s.points[i-1],s.points[i]);if(s.points.length===1)segment(page.ctx,s.points[0],s.points[0]);}); }
  function undo() { var last=state.history.pop();if(!last)return;var index=last.page.strokes.indexOf(last.stroke);if(index>=0)last.page.strokes.splice(index,1);redraw(last.page); }
  async function flattenPdf() {
    var doc=await PDFLib.PDFDocument.load(state.original), pdfPages=doc.getPages(), scale=2;
    for(var i=0;i<state.pages.length;i++){var page=state.pages[i];if(!page.strokes.length)continue;var canvas=document.createElement("canvas");canvas.width=page.width*scale;canvas.height=page.height*scale;var ctx=canvas.getContext("2d");ctx.scale(scale,scale);page.strokes.forEach(function(s){for(var n=1;n<s.points.length;n++)segment(ctx,s.points[n-1],s.points[n]);if(s.points.length===1)segment(ctx,s.points[0],s.points[0]);});var image=await doc.embedPng(canvas.toDataURL("image/png"));var target=pdfPages[page.index];target.drawImage(image,{x:0,y:0,width:target.getWidth(),height:target.getHeight()});}
    if(state.note){var page0=doc.getPage(0),font=await doc.embedFont(PDFLib.StandardFonts.Helvetica),bold=await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);var notePage=doc.insertPage(0,[page0.getWidth(),190]);notePage.drawText("DRIVER NOTES",{x:40,y:142,font:bold,size:14});var lines=state.note.match(/.{1,78}(?:\s|$)/g)||[state.note];lines.slice(0,5).forEach(function(line,index){notePage.drawText(line.trim(),{x:40,y:112-index*18,font:font,size:11});});}
    return base64FromBytes(await doc.save());
  }
  function submit() {
    if(state.submitting)return;var truckNumber=$("truckNumber").value.trim();
    if(!truckNumber){$("truckError").textContent="Enter the truck number.";$("truckNumber").focus();return;}
    state.submitting=true;$("truckError").textContent="";$("busy").hidden=false;$("busyText").textContent="Saving signed receipt...";
    flattenPdf().then(function(pdf){return json("/api/order/"+state.order.id+"/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({truck_number:truckNumber,note:state.note,pdf_b64:pdf})});})
      .then(function(){$("confirmModal").hidden=true;toast("Receipt completed");state.order=null;return load();})
      .catch(function(err){$("truckError").textContent=err.message;toast(err.message);}).finally(function(){state.submitting=false;$("busy").hidden=true;});
  }

  $("unlockForm").addEventListener("submit",function(e){e.preventDefault();$("unlockError").textContent="";json("/api/unlock",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:$("accessCode").value})}).then(load).catch(function(err){$("unlockError").textContent=err.message;});});
  $("refreshButton").onclick=load; $("backButton").onclick=load;
  $("penButton").onclick=function(){state.pen=!state.pen;this.classList.toggle("active",state.pen);}; $("undoButton").onclick=undo;
  $("noteButton").onclick=function(){$("noteText").value=state.note;$("noteModal").hidden=false;};
  $("cancelNote").onclick=function(){$("noteModal").hidden=true;}; $("saveNote").onclick=function(){state.note=$("noteText").value.trim();$("noteButton").classList.toggle("has-note",!!state.note);$("noteModal").hidden=true;};
  $("completeButton").onclick=function(){if(!state.pages.length){toast("Receipt is still loading");return;}$("truckNumber").value="";$("truckError").textContent="";$("confirmModal").hidden=false;setTimeout(function(){$("truckNumber").focus();},0);};
  $("cancelComplete").onclick=function(){$("confirmModal").hidden=true;}; $("confirmComplete").onclick=submit;
  if("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(function(){});
  json("/api/session").then(function(session){if(session.locked&&!session.unlocked)show("unlockView");else load();}).catch(function(){load();});
})();
