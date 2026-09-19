import {
  useEffect,
  useState,
} from "react";

import {
  ActivityIndicator,
  View,
} from "react-native";

import { useRouter } from "expo-router";

import { supabase } from "../services/supabase";
import { theme } from "../constants/theme";


export default function Index() {

  const router = useRouter();

  const [loading, setLoading] =
    useState(true);


  useEffect(() => {

    let mounted = true;


    async function checkSession() {

      const {
        data: { session },
      } = await supabase.auth.getSession();


      if (!mounted) return;


      if (session) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, is_active")
          .eq("id", session.user.id)
          .single();

        if (!profile || !profile.is_active) {
          await supabase.auth.signOut();
          router.replace("/login");
        } else if (profile.role === "processor") {
          router.replace("/processor-dashboard");
        } else if (profile.role === "worker") {
          router.replace("/dashboard");
        } else {
          await supabase.auth.signOut();
          router.replace("/login");
        }
      } else {
        router.replace("/login");
      }

      setLoading(false);
    }


    checkSession();


    return () => {
      mounted = false;
    };

  }, [router]);


  return (

    <View
      style={{
        flex: 1,
        justifyContent:
          "center",
        alignItems:
          "center",

        backgroundColor:
          theme.colors.background,
      }}
    >

      <ActivityIndicator
        size="large"
        color={
          theme.colors.primary
        }
      />

    </View>

  );

}