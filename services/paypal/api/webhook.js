/* Webhooks PayPal firmados. Sin token público y sin confiar en datos no verificados. */
import { paypalApi, paypalConfig } from '../lib/paypal-client.js';
import { creditCompletedOrder, applyRefundWebhook } from '../lib/wallet-service.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  const config=paypalConfig(),webhookId=process.env.PAYPAL_WEBHOOK_ID||'';
  if(!config.enabled||!config.clientId||!config.clientSecret||!webhookId)return res.status(503).json({error:'WEBHOOK_NOT_CONFIGURED'});
  const h=req.headers, event=req.body;
  if(!event||typeof event!=='object'||!event.id)return res.status(400).json({error:'INVALID_WEBHOOK'});
  const values={
    auth_algo:h['paypal-auth-algo'],cert_url:h['paypal-cert-url'],transmission_id:h['paypal-transmission-id'],
    transmission_sig:h['paypal-transmission-sig'],transmission_time:h['paypal-transmission-time'],
    webhook_id:webhookId,webhook_event:event
  };
  if(Object.values(values).some(x=>!x))return res.status(401).json({error:'WEBHOOK_SIGNATURE_MISSING'});
  try{
    const verification=await paypalApi('/v1/notifications/verify-webhook-signature',{method:'POST',body:values},config);
    if(verification.verification_status!=='SUCCESS')return res.status(401).json({error:'WEBHOOK_SIGNATURE_INVALID'});
    if(event.event_type==='PAYMENT.CAPTURE.COMPLETED'){
      const orderId=String(event.resource?.supplementary_data?.related_ids?.order_id||'');
      if(orderId){
        try{await creditCompletedOrder(orderId)}
        catch(e){
          if(e.message!=='ORDER_NOT_FOUND')throw e; // Puede ser un pago no relacionado con ADS.
        }
      }
    }
    if(event.event_type==='PAYMENT.CAPTURE.REFUNDED')await applyRefundWebhook(event);
    if(event.event_type==='PAYMENT.CAPTURE.REVERSED'){
      const original=event.resource||{};
      await applyRefundWebhook({
        resource:{
          id:'rev-'+event.id,
          amount:original.amount,
          supplementary_data:{related_ids:{capture_id:original.id}}
        }
      });
    }
    return res.status(200).json({verified:true});
  }catch(e){
    console.error('ADS PayPal webhook reconciliation:',String(e.message||e));
    return res.status(503).json({error:'WEBHOOK_RETRY_REQUIRED'});
  }
}
