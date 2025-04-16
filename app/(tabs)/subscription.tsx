import { Linking, Platform, StyleSheet } from 'react-native';

import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import type { ApiCheckoutType } from '@/app/api/checkout/[...everything]+api';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { hc } from 'hono/client';
import { fetch as expoFetch } from 'expo/fetch';

const checkoutClient = hc<ApiCheckoutType>('/', {
  fetch: expoFetch as unknown as typeof fetch
});

async function loadSubscription(checkoutSessionId?: string) {
  const res = await checkoutClient.api.checkout.subscription.$get({
    query: { checkoutSessionId }
  });

  if (!res.ok) {
    throw new Error('Failed to load subscription');
  }

  const result = await res.json();

  if (result.valid !== true) {
    throw new Error('Failed to load subscription');
  }

  return result;
}

async function loadPortalUrl() {
  const res = await checkoutClient.api.checkout.subscription.portal.$post({
    json: { platform: Platform.OS === 'web' ? 'web' : 'app' }
  });

  if (!res.ok) {
    throw new Error('Failed to load portal URL');
  }

  const result = await res.json();

  if (result.valid !== true) {
    throw new Error('Failed to load portal URL');
  }

  return result.url;
}

export default function Subscription() {
  const { checkoutSessionId } = useLocalSearchParams() as {
    checkoutSessionId?: string;
  };
  const [data, setData] = useState<Awaited<
    ReturnType<typeof loadSubscription>
  > | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadSubscriptionEffect() {
      setLoading(true);
      try {
        const result = await loadSubscription(checkoutSessionId);
        setData(result);
      } finally {
        setLoading(false);
      }
    }

    loadSubscriptionEffect();
  }, [checkoutSessionId]);

  const iapSource = data?.iapSource;

  const redirectToPortal = useCallback(async () => {
    let url;
    if (iapSource === 'stripe') {
      url = await loadPortalUrl();
    } else if (iapSource === 'ios') {
      url = 'https://apps.apple.com/account/subscriptions';
    } else if (iapSource === 'android') {
      url =
        'https://play.google.com/store/account/subscriptions?package=com.lexikon.lexikon';
    }

    if (url) {
      if (Platform.OS === 'web') {
        Linking.openURL(url);
      } else {
        WebBrowser.openBrowserAsync(url);
      }
    } else {
      alert(`Account Management unavailable for your account (${iapSource})`);
    }
  }, [iapSource]);

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
      headerImage={
        <IconSymbol
          size={310}
          color="#808080"
          name="chevron.left.forwardslash.chevron.right"
          style={styles.headerImage}
        />
      }
    >
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Subscription</ThemedText>
      </ThemedView>
      <ThemedView style={{ marginTop: 16 }}>
        {loading || !data ? (
          <ThemedText>Loading...</ThemedText>
        ) : data.subscription.planKeyname === 'free' ? (
          <ThemedText>
            You are currently on the free plan. Upgrade to access more features.
          </ThemedText>
        ) : (
          <ThemedText>
            You are currently on the {data.subscription.planKeyname} plan.
            Thanks for subscribing! 🎉
          </ThemedText>
        )}
        {!loading && data && (
          <ThemedView style={{ marginTop: 16 }}>
            {data.subscription.planKeyname === 'free' ? (
              <Link href="/">
                <ThemedText style={{ textAlign: 'center', padding: 12 }}>
                  Upgrade
                </ThemedText>
              </Link>
            ) : (
              <ThemedText
                style={{ textAlign: 'center', padding: 12 }}
                onPress={redirectToPortal}
              >
                Manage Subscription
              </ThemedText>
            )}
          </ThemedView>
        )}
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: '#808080',
    bottom: -90,
    left: -35,
    position: 'absolute'
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8
  }
});
