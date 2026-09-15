import { HttpError } from '../errors/http-error.js';
import { payOrder } from '../services/payment.service.js';

export async function pay(req, res) {
  const { payment, order } = await payOrder(req.user.id, req.validated.body, req.log);

  if (payment.status === 'succeeded') {
    res.created({ payment, order });
    return;
  }

  // The attempt is already recorded and committed at this point, so raising
  // here reports the outcome without discarding the evidence of it.
  //
  // 402 means the card said no and the caller can try another one.
  // 502 means the provider itself failed and the same card may work on retry.
  const declined = payment.status === 'declined';

  throw new HttpError(
    declined ? 402 : 502,
    payment.failure?.message ?? 'The payment could not be completed',
    {
      code: declined ? 'PAYMENT_DECLINED' : 'PAYMENT_PROVIDER_ERROR',
      expose: true,
      details: {
        paymentId: payment.id,
        orderId: order.id,
        orderStatus: order.status,
        failureCode: payment.failure?.code,
      },
    },
  );
}
