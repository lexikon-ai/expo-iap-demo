import { verifyAppleJWT } from './apple-billing';
import { GooglePlay } from './google-play';
import { SubscriptionPurchase } from './google-play-billing';
import {
  AppStoreServerAPI,
  type DecodedNotificationDataPayload,
  Environment,
  type JWSRenewalInfoDecodedPayload
} from 'app-store-server-api';
import Stripe from 'stripe';
import { PRODUCT_ID } from './products';

const BUNDLE_ID = process.env.BUNDLE_ID!;

const iap = {
  googlePayment: new GooglePlay({
    email: 'google-play-dev@lexikon-ai.iam.gserviceaccount.com',
    key: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY!,
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  }),
  applePaymentSandbox: new AppStoreServerAPI(
    process.env.APPLE_STORE_PRIVATE_KEY!,
    process.env.APPLE_STORE_KEY_ID!,
    process.env.APPLE_STORE_ISSUER_ID!,
    BUNDLE_ID,
    Environment.Sandbox
  ),
  applePaymentProduction: new AppStoreServerAPI(
    process.env.APPLE_STORE_PRIVATE_KEY!,
    process.env.APPLE_STORE_KEY_ID!,
    process.env.APPLE_STORE_ISSUER_ID!,
    BUNDLE_ID,
    Environment.Production
  ),
  webPayment: new Stripe(process.env.STRIPE_SECRET_KEY!)
};

export async function createWebPaymentCustomerId(
  customer: Stripe.CustomerCreateParams
) {
  return (await iap.webPayment.customers.create(customer)).id;
}

export async function findWebPaymentCustomerIdByEmail(email: string) {
  const customers = await iap.webPayment.customers
    .list({ email })
    .autoPagingToArray({ limit: 1 });
  return customers.length > 0 ? customers[0].id : null;
}

export async function createWebPaymentCheckoutSession({
  userId,
  successUrl,
  cancelUrl,
  customerId
}: {
  userId: string;
  successUrl: string;
  cancelUrl: string;
  customerId: string;
}) {
  const session = await iap.webPayment.checkout.sessions.create({
    line_items: [
      {
        price: process.env.PREMIUM_MONTHLY_PRICE_ID!,
        quantity: 1
      }
    ],
    mode: 'subscription',
    customer: customerId,
    customer_update: {
      address: 'auto'
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    automatic_tax: { enabled: true },
    metadata: {
      userId
    }
  });

  if (!session.url) {
    throw new Error('No session URL');
  }

  return session.url;
}

export async function verifyPurchase(
  iapSource: 'ios' | 'android',
  transactionReceipt: string
) {
  let json;
  try {
    json = JSON.parse(transactionReceipt);
  } catch (error) {
    throw new Error('Invalid JSON');
  }

  if (!isObject(json)) {
    throw new Error('Invalid JSON');
  }

  if (iapSource === 'ios') {
    const transactionId =
      typeof json.originalTransactionId === 'string'
        ? json.originalTransactionId
        : typeof json.transactionId === 'string'
          ? json.transactionId
          : undefined;

    if (!transactionId) {
      throw new Error('Invalid JSON');
    }

    const { isActive } = await findIosPaymentInfoByTransactionId(transactionId);

    if (!isActive) {
      throw new Error('Subscription is not active');
    }

    return transactionId;
  }

  // android

  if (typeof json.purchaseToken !== 'string') {
    throw new Error('Invalid JSON (missing purchaseToken)');
  }

  if (typeof json.productId !== 'string') {
    throw new Error('Invalid JSON (missing productId)');
  }

  const { isActive, purchaseToken } =
    await findAndroidPaymentInfoByProductIdAndPurchaseToken(
      PRODUCT_ID,
      json.purchaseToken
    );

  if (!isActive) {
    throw new Error('Subscription is not active');
  }

  return purchaseToken;
}

export async function generatePortalUrl(iapId: string, returnUrl?: string) {
  const { url } = await iap.webPayment.billingPortal.sessions.create({
    customer: iapId,
    return_url: returnUrl
  });

  return url;
}

export async function findWebPaymentInfoByCustomerId(customerId: string) {
  try {
    // Retrieve customer's subscriptions
    const subscriptions = await iap.webPayment.subscriptions
      .list({ customer: customerId })
      .autoPagingToArray({ limit: 1 });

    // Check if there's any subscription and if it's active
    const isActive =
      subscriptions.length > 0 &&
      ['active', 'trialing'].includes(subscriptions[0].status);

    return { isActive };
  } catch (error) {
    console.error(
      `Error finding web payment info for customer ${customerId}:`,
      error
    );
    return { isActive: false };
  }
}

export async function findWebPaymentInfoByCheckoutSessionId(
  checkoutSessionId: string
) {
  let checkoutSession;
  try {
    checkoutSession =
      await iap.webPayment.checkout.sessions.retrieve(checkoutSessionId);
  } catch (error) {
    console.error(error);
    return null;
  }

  // the subscription could be cancelled if the user loaded an old checkout session ID
  // if this technique isn't working, we could just ignore the checkout session by date
  let subscriptionIsCancelled = false;
  const subscriptionId =
    typeof checkoutSession.subscription === 'string'
      ? checkoutSession.subscription
      : checkoutSession.subscription?.id;
  if (subscriptionId) {
    const subscription =
      await iap.webPayment.subscriptions.retrieve(subscriptionId);
    subscriptionIsCancelled = [
      'incomplete',
      'incomplete_expired',
      'trialing',
      'canceled',
      'paused'
    ].includes(subscription.status);
  }

  if (checkoutSession.payment_status !== 'unpaid' && !subscriptionIsCancelled) {
    const userId = checkoutSession.metadata?.userId;
    const customerId =
      typeof checkoutSession.customer === 'string'
        ? checkoutSession.customer
        : checkoutSession.customer?.id;

    if (!userId || !customerId) {
      throw new Error(
        'Missing userId or customerId during checkout session fulfillment'
      );
    }

    // there's only one thing to purchase right now, but in the future could add line_item details here
    return { userId, customerId };
  }

  return null;
}

export async function findAndroidPaymentInfoByProductIdAndPurchaseToken(
  productId: string,
  purchaseToken: string
) {
  const url = `https://www.googleapis.com/androidpublisher/v3/applications/${BUNDLE_ID}/purchases/subscriptions/${productId}/tokens/${purchaseToken}`;
  const res = await iap.googlePayment.request(url);

  const sub = SubscriptionPurchase.fromApiResponse(res, purchaseToken);

  return { isActive: sub.isEntitlementActive(), purchaseToken };
}

async function tryApplePaymentGetSubscriptionStatuses(transactionId: string) {
  let subscriptionStatuses;
  // per app store review process:
  // When validating receipts on your server, your server needs to be able to handle a production-signed
  // app getting its receipts from Apple’s test environment. The recommended approach is
  // for your production server to always validate receipts against the production App Store first.
  // If validation fails with the error code "Sandbox receipt used in production,"
  // you should validate against the test environment instead.
  try {
    subscriptionStatuses =
      await iap.applePaymentProduction.getSubscriptionStatuses(transactionId);
  } catch (error) {
    console.error('Error fetching subscription statuses in production:', error);
    try {
      subscriptionStatuses =
        await iap.applePaymentSandbox.getSubscriptionStatuses(transactionId);
    } catch (error) {
      console.error('Error fetching subscription statuses in sandbox:', error);
      throw error;
    }
  }

  return subscriptionStatuses;
}

export async function findIosPaymentInfoByTransactionId(transactionId: string) {
  const subscriptionStatuses =
    await tryApplePaymentGetSubscriptionStatuses(transactionId);

  const items =
    subscriptionStatuses?.data?.flatMap(
      (item) => item.lastTransactions || []
    ) || [];
  const sub = items.find(
    (item) => item.originalTransactionId === transactionId
  );

  if (!sub) {
    throw new Error(`Could not find transaction by ID: ${transactionId}`);
  }

  const renewalInfo = await verifyAppleJWT<JWSRenewalInfoDecodedPayload>(
    sub.signedRenewalInfo
  );

  return findIosPaymentInfoByRenewalInfo(renewalInfo);
}

async function findIosPaymentInfoByRenewalInfo(
  renewalInfo: JWSRenewalInfoDecodedPayload
) {
  // https://developer.apple.com/documentation/appstoreserverapi/expirationintent
  return {
    isActive: !renewalInfo.expirationIntent
  };
}

export async function processWebPaymentNotification(
  notification: string,
  signature: string
) {
  let event;
  try {
    event = await iap.webPayment.webhooks.constructEventAsync(
      notification,
      signature,
      process.env.STRIPE_WEBHOOK_SIGNING_SECRET!
    );
  } catch (err) {
    console.error(err);
    throw new Error('Invalid webhook signature');
  }

  switch (event.type) {
    case 'customer.subscription.deleted': {
      const { customer } = event.data.object;
      const customerId = typeof customer === 'string' ? customer : customer.id;
      console.log(`Subscription deleted for customer ${customerId}`);
      return { action: 'cancel', customerId } as const;
    }
    case 'checkout.session.completed': {
      const info = await findWebPaymentInfoByCheckoutSessionId(
        event.data.object.id
      );

      if (info) {
        return {
          action: 'fulfill',
          userId: info.userId,
          customerId: info.customerId
        } as const;
      }

      return null;
    }
    default:
      console.error(`Unhandled event type: ${event.type}`);
      return null;
  }
}

export async function processIosPaymentNotification(signedPayload: string) {
  const payload =
    await verifyAppleJWT<DecodedNotificationDataPayload>(signedPayload);

  if (payload.data?.bundleId === BUNDLE_ID) {
    if (payload.data.signedRenewalInfo) {
      const renewalInfo = await verifyAppleJWT<JWSRenewalInfoDecodedPayload>(
        payload.data.signedRenewalInfo
      );

      const { isActive } = await findIosPaymentInfoByRenewalInfo(renewalInfo);

      if (isActive) {
        return {
          action: 'fulfill' as const,
          iapId: renewalInfo.originalTransactionId
        };
      }

      return {
        action: 'cancel' as const,
        iapId: renewalInfo.originalTransactionId
      };
    }
  } else {
    throw new Error(`Invalid bundle ID: ${payload.data?.bundleId}`);
  }

  return null;
}
export async function processAndroidPaymentNotification(
  productId: string,
  purchaseToken: string
) {
  const { isActive } = await findAndroidPaymentInfoByProductIdAndPurchaseToken(
    productId,
    purchaseToken
  );

  if (isActive) {
    return { action: 'fulfill' as const, iapId: purchaseToken };
  }

  return { action: 'cancel' as const, iapId: purchaseToken };
}

function isObject(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === 'object' && obj !== null;
}
