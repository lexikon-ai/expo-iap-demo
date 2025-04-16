import { HelloWave } from '@/components/HelloWave';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import {
  endConnection,
  finishTransaction,
  getAvailablePurchases,
  getSubscriptions,
  initConnection,
  purchaseUpdatedListener,
  requestPurchase
} from '@/utils/iap';
import { products } from '@/utils/products';
import { fetch as expoFetch } from 'expo/fetch';
import { hc } from 'hono/client';
import { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Image,
  View
} from 'react-native';

import type { ApiCheckoutType } from '@/app/api/checkout/[...everything]+api';

const PRODUCT_SKU = products[0].id;

type Product = {
  id: string;
  displayPrice?: string;
  subscriptionOfferDetails?: { offerToken: string }[];
  offerToken?: string; // android only
};

const checkoutClient = hc<ApiCheckoutType>('/', {
  fetch: expoFetch as unknown as typeof fetch
});

async function createCheckoutUrl() {
  const res = await checkoutClient.api.checkout.web.$post({
    json: {}
  });

  const data = await res.json();
  if (data.valid !== true) {
    throw new Error('Failed to create checkout URL');
  }

  return data;
}

async function postIAPReceipt(iapSource: 'ios' | 'android', receipt: string) {
  const res = await checkoutClient.api.checkout.iap.$post({
    json: {
      iapSource,
      transactionReceipt: receipt
    }
  });

  const data = await res.json();
  if (data.valid !== true) {
    if (res.status === 410) {
      // sometimes, at least during development,
      // the `purchaseUpdatedListener` will be called with old, expired receipts
      // upon page load
      // alert('Posted subscription is expired');
      return null;
    }

    throw new Error('Failed to verify IAP receipt');
  }

  return data;
}

export default function Upgrade() {
  const [isConnected, setIsConnected] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // typically you would load this information from your current user (if available)
  // or make a database call on the backend
  const [hasSubscription, setHasSubscription] = useState(false);

  const updateUser = (attrs: { planKeyname: string; planInterval: string }) => {
    // TODO: update user across rest of app so they can access new features
    setHasSubscription(true);
  };

  useEffect(() => {
    const setupIAP = async () => {
      if (await initConnection()) {
        setIsConnected(true);

        const products = await getSubscriptions([PRODUCT_SKU]);
        if (products.length) {
          // console.log('Products:', products[0]);
          setProduct(products[0]);
        } else {
          alert('No products found');
        }
      } else {
        alert(
          `Unable to establish a connection to the ${
            Platform.OS === 'ios' ? 'App Store' : 'Google Play'
          } store.`
        );
      }
    };
    setupIAP();

    const purchaseListener =
      Platform.OS === 'web'
        ? null
        : purchaseUpdatedListener(async (purchase) => {
            // console.log('PURCHASE!', purchase);
            if (purchase) {
              await finishTransaction({ purchase });
              setIsLoading(true);
              const iapResult = await postIAPReceipt(
                Platform.OS === 'ios' ? 'ios' : 'android',
                purchase.transactionReceipt
              );
              if (iapResult?.subscription) {
                updateUser(iapResult.subscription);
              }
            }

            setIsLoading(false);
          });

    return () => {
      purchaseListener?.remove();
      endConnection();
    };
  }, []);

  const productId = product?.id;
  const firstOfferToken = product?.subscriptionOfferDetails?.[0]?.offerToken;

  const redirectToCheckout = useCallback(async () => {
    if (!productId) {
      alert('No product');
    }

    try {
      setIsLoading(true);
      const data = await createCheckoutUrl();

      // @ts-ignore - this works in react-native-web: https://necolas.github.io/react-native-web/docs/linking/#static-methods
      Linking.openURL(data.url, '_self');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'An unknown error ocurred');
    } finally {
      setIsLoading(false);
    }
  }, [productId]);

  const buyItem = useCallback(async () => {
    if (!productId) {
      alert('No product available');
      return;
    }
    if (!firstOfferToken && Platform.OS === 'android') {
      alert('No offer token available');
      return;
    }

    // console.log('Buying item with ID:', productId);
    if (Platform.OS === 'web') {
      await redirectToCheckout();
      return;
    }

    setIsLoading(true);

    try {
      await requestPurchase({
        request:
          Platform.OS === 'android'
            ? {
                skus: [productId],
                subscriptionOffers: [
                  { sku: productId, offerToken: firstOfferToken! }
                ]
              }
            : { sku: productId },
        type: 'subs'
      });
    } catch (error) {
      if (error instanceof Error) {
        if (
          // iOS
          error.message === 'Purchase failed: User cancelled the purchase' ||
          // Android
          error.message === 'Payment is cancelled.'
        ) {
          return;
        }
        console.error(error);
        alert(error.message);
      } else {
        console.error(error);
        alert('An unexpected error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  }, [productId, firstOfferToken, redirectToCheckout]);

  // iOS / android only
  const restorePurchases = useCallback(async () => {
    try {
      const result = await getAvailablePurchases({
        alsoPublishToEventListener: false, // `finishTransaction` doesn't seem to work here
        onlyIncludeActiveItems: true
      });
      if (result.length === 0) {
        alert('No active purchases found');
        return;
      }

      setIsLoading(true);

      for (const purchase of result) {
        const iapResult = await postIAPReceipt(
          Platform.OS === 'ios' ? 'ios' : 'android',
          purchase.transactionReceipt
        );
        if (iapResult?.subscription) {
          updateUser(iapResult.subscription);
        }
      }

      setIsLoading(false);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Purchase failed: User cancelled the purchase') {
          return;
        }
        alert(error.message);
      } else {
        console.error(error);
        alert('An unexpected error occurred');
      }
    }
  }, []);

  const isConnectedAndNotLoading = isConnected && !isLoading;

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }
    >
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Welcome!</ThemedText>
        <HelloWave />
      </ThemedView>
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">
          This is your paywall, where you would typically display your product
          or service and the corresponding price.
        </ThemedText>
        <ThemedText>
          {isConnectedAndNotLoading ? (
            hasSubscription ? (
              <ThemedText>
                You are currently on the Pro plan. Thanks for subscribing! 🎉
              </ThemedText>
            ) : (
              <View>
                {product?.displayPrice ? (
                  <View>
                    <ThemedText style={{ paddingBottom: 16 }}>
                      Only {product.displayPrice}/month
                    </ThemedText>
                  </View>
                ) : null}

                <Pressable style={styles.button} onPress={buyItem}>
                  <ThemedText style={styles.buttonText}>Upgrade Now</ThemedText>
                </Pressable>

                {Platform.OS !== 'web' && (
                  <Pressable
                    style={[
                      styles.button,
                      {
                        backgroundColor: 'transparent',
                        borderWidth: 1,
                        borderColor: '#007AFF',
                        marginTop: 8
                      }
                    ]}
                    onPress={restorePurchases}
                  >
                    <ThemedText style={styles.buttonText}>
                      Restore Purchases
                    </ThemedText>
                  </Pressable>
                )}
              </View>
            )
          ) : (
            <ThemedView style={{ padding: 16 }}>
              <ThemedText>Loading...</ThemedText>
            </ThemedView>
          )}
        </ThemedText>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute'
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8
  },
  buttonText: {
    color: '#FFFFFF'
  }
});
