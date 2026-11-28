use url::Url;

/// Maps a `mimus://auth/callback?code=…` deep link to the web app's own
/// `/auth/callback` on `base`, where the webview's PKCE verifier cookie
/// completes the sign-in. Anything else is rejected.
pub fn callback_target(link: &str, base: &Url) -> Option<Url> {
    let link = Url::parse(link).ok()?;
    if link.scheme() != "mimus"
        || link.host_str() != Some("auth")
        || link.path() != "/callback"
        || !link.username().is_empty()
        || link.password().is_some()
        || link.port().is_some()
    {
        return None;
    }

    let code = link
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned())
        .filter(|code| !code.is_empty())?;

    let mut target = base.join("/auth/callback").ok()?;
    target.query_pairs_mut().clear().append_pair("code", &code);
    Some(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Url {
        Url::parse("https://getmimus.io").unwrap()
    }

    #[test]
    fn maps_a_callback_link_to_the_web_callback() {
        let target = callback_target("mimus://auth/callback?code=abc-123", &base()).unwrap();
        assert_eq!(
            target.as_str(),
            "https://getmimus.io/auth/callback?code=abc-123"
        );
    }

    #[test]
    fn keeps_the_base_origin_for_a_dev_build() {
        let dev = Url::parse("http://localhost:3000").unwrap();
        let target = callback_target("mimus://auth/callback?code=xyz", &dev).unwrap();
        assert_eq!(
            target.as_str(),
            "http://localhost:3000/auth/callback?code=xyz"
        );
    }

    #[test]
    fn re_encodes_the_code() {
        let target =
            callback_target("mimus://auth/callback?code=a%26next%3D%2F%2Fevil", &base()).unwrap();
        assert_eq!(target.query_pairs().count(), 1);
        assert_eq!(target.query_pairs().next().unwrap().1, "a&next=//evil");
    }

    #[test]
    fn drops_every_param_except_code() {
        let target = callback_target(
            "mimus://auth/callback?code=abc&next=https://evil.test",
            &base(),
        )
        .unwrap();
        assert_eq!(
            target.as_str(),
            "https://getmimus.io/auth/callback?code=abc"
        );
    }

    #[test]
    fn rejects_other_schemes_hosts_and_paths() {
        for link in [
            "https://auth/callback?code=abc",
            "mimus://evil/callback?code=abc",
            "mimus://auth/other?code=abc",
            "mimus://auth/callback/extra?code=abc",
            "mimus://user@auth/callback?code=abc",
        ] {
            assert!(callback_target(link, &base()).is_none(), "{link}");
        }
    }

    #[test]
    fn rejects_a_missing_or_empty_code() {
        assert!(callback_target("mimus://auth/callback", &base()).is_none());
        assert!(callback_target("mimus://auth/callback?code=", &base()).is_none());
        assert!(callback_target("not a url", &base()).is_none());
    }
}
