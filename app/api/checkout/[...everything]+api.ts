import {
  createWebPaymentCheckoutSession,
  createWebPaymentCustomerId,
  findWebPaymentCustomerIdByEmail,
  findWebPaymentInfoByCheckoutSessionId,
  generatePortalUrl,
  processAndroidPaymentNotification,
  processIosPaymentNotification,
  processWebPaymentNotification,
  verifyPurchase
} from '@/utils/iap-backend';
import { handle } from 'hono/vercel';
import { sValidator } from '@hono/standard-validator';
import { type Env, Hono } from 'hono';
import * as v from 'valibot';

async function getUserIdByIapId(iapId: string): Promise<string | null> {
  console.log(
    'TODO: Implement getUserIdByIapId with your database-specific functionality'
  );
  console.log('Looking up user with iapId:', iapId);

  // This is a stub. Replace with actual database logic.
  return null;
}

async function updateUserById(
  userId: string,
  data: {
    planKeyname: 'premium' | 'free';
    planInterval: 'monthly' | 'yearly';
    iapId: string | null;
    iapSource: 'stripe' | 'android' | 'ios' | null;
  }
): Promise<void> {
  console.log(
    'TODO: Implement updateUserById with your database-specific functionality'
  );
  console.log('Updating user:', userId, 'with data:', data);

  // This is a stub. Replace with actual database logic.
  return;
}

async function getLoggedInUser(req: Request) {
  console.log(
    'TODO: Implement getLoggedInUser with your database-specific functionality'
  );
  console.log('Looking up logged in user');

  // This is a stub. Replace with actual database logic.
  return {
    id: 'mock-user-id',
    email: 'mock-user@example.com',
    name: 'Mock User',
    iapId: null,
    iapSource: null,
    planKeyname: 'free' as 'free' | 'premium',
    planInterval: 'monthly' as 'monthly' | 'yearly'
  };
}

const app = new Hono<Env>()
  .basePath('/api/checkout')
  // NOTES:
  // android - does not have a sandbox, webhooks configured via Google Cloud Console Pub/Sub
  // ios - does have a sandbox, webhooks configured via Apple App Store Connect
  // web - does have a sandbox (many, even!), webhooks configured via Stripe Dashboard
  .post('/notification', async (c) => {
    const stripeSignature = c.req.header('stripe-signature');
    let iapId;
    let iapSource: 'stripe' | 'android' | 'ios' | null = null;
    let userId;
    let action: 'cancel' | 'fulfill' | undefined = undefined;
    if (stripeSignature) {
      const resp = await processWebPaymentNotification(
        await c.req.text(),
        stripeSignature
      );

      if (resp) {
        action = resp.action;
        iapId = resp.customerId;
        userId = resp.userId;
        iapSource = 'stripe';
      }
    }

    let json;
    try {
      json = await c.req.json();
    } catch (error) {
      console.error('Error parsing Notification JSON:', error);
      return c.json({ valid: false } as const);
    }

    // ios: {"signedPayload": "..."}
    if (typeof json.signedPayload === 'string') {
      const resp = await processIosPaymentNotification(json.signedPayload);
      if (resp) {
        action = resp.action;
        iapId = resp.iapId;
        iapSource = 'ios';
      }
    } else if (
      typeof json.message === 'object' &&
      json.message !== null &&
      typeof json.message.data === 'string'
    ) {
      // android: {"message":{"data":"base64_encoded_json"}}
      // decoded: {"version":"<str>","packageName":"<str>","eventTimeMillis":"<timestampMillis>","subscriptionNotification":{"version":"<str>","notificationType":<int>,"purchaseToken":"<str>","subscriptionId":"<str>"}}
      let decodedMessage;
      try {
        decodedMessage = JSON.parse(atob(json.message.data));
      } catch (error) {
        console.error('Error parsing Notification JSON (android):', error);
        return c.json({ valid: false } as const);
      }

      if (
        typeof decodedMessage.subscriptionNotification === 'object' &&
        decodedMessage.subscriptionNotification !== null &&
        typeof decodedMessage.subscriptionNotification.purchaseToken ===
          'string' &&
        typeof decodedMessage.subscriptionNotification.subscriptionId ===
          'string'
      ) {
        const resp = await processAndroidPaymentNotification(
          decodedMessage.subscriptionNotification.subscriptionId,
          decodedMessage.subscriptionNotification.purchaseToken
        );

        if (resp) {
          iapSource = 'android';
          action = resp.action;
          iapId = resp.iapId;
        }
      }
    }

    console.log('ACTION:', action, iapId, iapSource);

    if (!action) {
      const text = await c.req.text();
      console.error(`RECEIVED UNHANDLED NOTIFICATION: ${text}`);
      return c.json({ valid: false } as const);
    }

    if (!iapId) {
      throw new Error('iapId is required');
    }

    if (!iapSource) {
      throw new Error('iapSource is required');
    }

    if (action === 'fulfill') {
      if (!userId) {
        userId = await getUserIdByIapId(iapId);
      }

      if (userId) {
        await updateUserById(userId, {
          planKeyname: 'premium',
          planInterval: 'monthly',
          iapId,
          iapSource
        });
      }
    } else if (action === 'cancel') {
      const userId = await getUserIdByIapId(iapId);

      if (userId) {
        await updateUserById(userId, {
          planKeyname: 'free',
          planInterval: 'monthly',
          iapId: null,
          iapSource: null
        });
      } else {
        console.warn('No user found for iapId:', iapId);
      }
    }

    return c.json({ valid: true } as const);
  })
  .post(
    '/iap',
    sValidator(
      'json',
      v.object({
        iapSource: v.picklist(['ios', 'android']),
        transactionReceipt: v.pipe(
          v.string(),
          v.minLength(1),
          v.maxLength(1024)
        )
      }),
      async (result) => {
        if (!result.success) {
          console.error('Validation failed:', result.error);
        }
      }
    ),
    async (c) => {
      const user = await getLoggedInUser(c.req.raw);
      const { iapSource, transactionReceipt } = c.req.valid('json');
      let iapId;
      try {
        iapId = await verifyPurchase(iapSource, transactionReceipt);
      } catch (e) {
        if (e instanceof Error && e.message === 'Subscription is not active') {
          return c.json(
            {
              valid: false,
              error: e.message
            } as const,
            410
          );
        }

        throw e;
      }

      const existingUserId = await getUserIdByIapId(iapId);

      if (existingUserId && user && existingUserId !== user.id) {
        // move subscription from existing user to current user
        // (e.g. they kept the same apple ID but switched user accounts on our end)
        await updateUserById(existingUserId, {
          planKeyname: 'free',
          planInterval: 'monthly',
          iapId: null,
          iapSource: null
        });
      }

      await updateUserById(user.id, {
        planKeyname: 'premium',
        planInterval: 'monthly',
        iapId,
        iapSource
      });

      return c.json({
        valid: true,
        subscription: {
          planKeyname: 'premium',
          planInterval: 'monthly'
        }
      } as const);
    }
  )
  .post('/web', async (c) => {
    const user = await getLoggedInUser(c.req.raw);

    let iapId: string | null = user.iapId;
    const iapSource = user.iapSource;

    if (iapSource && iapSource !== 'stripe') {
      return c.json(
        {
          valid: false,
          error: `You are already subscribed via ${iapSource}.`
        } as const,
        { status: 400 }
      );
    }

    if (!iapId) {
      iapId = await findWebPaymentCustomerIdByEmail(user.email.toLowerCase());

      if (!iapId) {
        iapId = await createWebPaymentCustomerId({
          email: user.email.toLowerCase(),
          metadata: {
            userId: user.id
          }
        });

        if (!iapId) {
          throw new Error('Stripe did not return a customer ID');
        }
      }
    }

    const redirectUrl =
      'http://localhost:8081/subscription?checkoutSessionId={CHECKOUT_SESSION_ID}';

    const url = await createWebPaymentCheckoutSession({
      userId: user.id,
      customerId: iapId,
      successUrl: redirectUrl,
      cancelUrl: redirectUrl
    });

    return c.json({ valid: true, url } as const);
  })
  .get('/subscription', async (c) => {
    const user = await getLoggedInUser(c.req.raw);
    const checkoutSessionId = c.req.query('checkoutSessionId');

    let iapId: string | null = user.iapId;
    let subscription = {
      planKeyname: user.planKeyname,
      planInterval: user.planInterval
    };

    // this is used for Stripe - after checkout the user gets redirected here
    // and we don't necessarily have their subscription details yet
    // see https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted#redirect-hosted-checkout
    if (checkoutSessionId) {
      const info =
        await findWebPaymentInfoByCheckoutSessionId(checkoutSessionId);

      if (info) {
        if (info.userId !== user.id) {
          throw new Error('UserId Mismatch during checkout');
        }
        subscription = {
          planKeyname: 'premium',
          planInterval: 'monthly'
        } as const;

        iapId = info.customerId;
      }
    }

    if (
      iapId &&
      (user.planKeyname !== subscription.planKeyname ||
        user.planInterval !== subscription.planInterval)
    ) {
      await updateUserById(user.id, {
        planKeyname: subscription.planKeyname,
        planInterval: subscription.planInterval,
        iapId,
        iapSource: 'stripe'
      });

      user.planKeyname = subscription.planKeyname;
      user.planInterval = subscription.planInterval;
    }

    return c.json({
      valid: true,
      iapSource: user.iapSource as 'ios' | 'android' | 'stripe' | null,
      subscription: {
        planKeyname: user.planKeyname,
        planInterval: user.planInterval
      }
    } as const);
  })
  .post(
    '/subscription/portal',
    sValidator(
      'json',
      v.object({
        platform: v.picklist(['app', 'web'])
      }),
      async (result) => {
        if (!result.success) {
          console.error('Validation failed:', result.error);
        }
      }
    ),
    async (c) => {
      const user = await getLoggedInUser(c.req.raw);

      if (user.iapSource !== 'stripe' || !user.iapId) {
        return c.json(
          {
            valid: false,
            error: 'Stripe users can only access the portal'
          } as const,
          {
            status: 400
          }
        );
      }

      const url = await generatePortalUrl(user.iapId);

      return c.json({ valid: true, url } as const);
    }
  );

export type ApiCheckoutType = typeof app;

const handler = handle(app);

export const POST = handler;
export const GET = handler;
