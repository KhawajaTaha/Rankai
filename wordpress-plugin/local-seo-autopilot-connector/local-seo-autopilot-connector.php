<?php
/**
 * Plugin Name:       Local SEO Autopilot Connector
 * Description:       Secure connector between this WordPress site and the Local SEO Autopilot platform. Reads pages/posts/metadata, applies safe SEO changes (metadata, alt text, internal links, schema), publishes blogs, and supports snapshots + rollback. Elementor-aware: never rewrites page layouts.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Local SEO Autopilot
 * License:           GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

final class LSA_Connector
{
    const OPTION_SECRET = 'lsa_shared_secret';
    const NS = 'lsa/v1';
    const MAX_SKEW = 300; // seconds

    public static function init(): void
    {
        add_action('rest_api_init', [self::class, 'routes']);
        add_action('admin_menu', [self::class, 'menu']);
        add_action('admin_init', [self::class, 'register_setting']);
        add_action('wp_head', [self::class, 'print_schema'], 5);
    }

    // ───────────────────────── Settings ─────────────────────────

    public static function menu(): void
    {
        add_options_page('Local SEO Autopilot', 'Local SEO Autopilot', 'manage_options', 'lsa-connector', [self::class, 'settings_page']);
    }

    public static function register_setting(): void
    {
        register_setting('lsa_connector', self::OPTION_SECRET, [
            'type' => 'string',
            'sanitize_callback' => static fn($v) => preg_replace('/[^A-Za-z0-9_\-]/', '', (string) $v),
        ]);
    }

    public static function settings_page(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        echo '<div class="wrap"><h1>Local SEO Autopilot Connector</h1>';
        echo '<p>Paste the shared secret shown in Local SEO Autopilot (Client → Website SEO → Connections). Every request from the platform is HMAC-signed with this secret and rejected if it is older than 5 minutes or replayed.</p>';
        echo '<form method="post" action="options.php">';
        settings_fields('lsa_connector');
        printf('<input type="password" name="%s" value="%s" class="regular-text" autocomplete="off" />', esc_attr(self::OPTION_SECRET), esc_attr(get_option(self::OPTION_SECRET, '')));
        submit_button('Save secret');
        echo '</form></div>';
    }

    // ───────────────────────── Auth ─────────────────────────

    /** Verify HMAC-SHA256(secret, "ts\nMETHOD\n/wp-json/lsa/v1/route\nbody") with replay protection. */
    public static function verify(WP_REST_Request $req)
    {
        $secret = (string) get_option(self::OPTION_SECRET, '');
        if ($secret === '') {
            return new WP_Error('lsa_not_configured', 'Connector secret not configured', ['status' => 503]);
        }
        $ts = (string) $req->get_header('x_lsa_timestamp');
        $sig = (string) $req->get_header('x_lsa_signature');
        if (!ctype_digit($ts) || abs(time() - (int) $ts) > self::MAX_SKEW) {
            return new WP_Error('lsa_stale', 'Stale or missing timestamp', ['status' => 401]);
        }
        $route = '/wp-json' . $req->get_route();
        $payload = $ts . "\n" . $req->get_method() . "\n" . $route . "\n" . $req->get_body();
        $expected = hash_hmac('sha256', $payload, $secret);
        if (!hash_equals($expected, $sig)) {
            return new WP_Error('lsa_bad_signature', 'Invalid signature', ['status' => 401]);
        }
        $replayKey = 'lsa_sig_' . substr($sig, 0, 40);
        if (get_transient($replayKey)) {
            return new WP_Error('lsa_replay', 'Replayed request', ['status' => 401]);
        }
        set_transient($replayKey, 1, self::MAX_SKEW * 2);
        return true;
    }

    // ───────────────────────── Routes ─────────────────────────

    public static function routes(): void
    {
        $auth = [self::class, 'verify'];
        $r = static function (string $path, string $method, callable $cb) use ($auth) {
            register_rest_route(self::NS, $path, ['methods' => $method, 'callback' => $cb, 'permission_callback' => $auth]);
        };
        $r('/status', 'GET', [self::class, 'status']);
        $r('/content', 'GET', [self::class, 'list_content']);
        $r('/content/(?P<id>\d+)', 'GET', [self::class, 'get_content']);
        $r('/meta', 'POST', [self::class, 'update_meta']);
        $r('/image-alt', 'POST', [self::class, 'image_alt']);
        $r('/schema', 'POST', [self::class, 'schema']);
        $r('/internal-link', 'POST', [self::class, 'internal_link']);
        $r('/replace-link', 'POST', [self::class, 'replace_link']);
        $r('/posts', 'POST', [self::class, 'create_post']);
        $r('/snapshot', 'GET', [self::class, 'snapshot']);
        $r('/restore', 'POST', [self::class, 'restore']);
    }

    public static function seo_plugin(): ?string
    {
        if (defined('RANK_MATH_VERSION')) return 'rank_math';
        if (defined('WPSEO_VERSION')) return 'yoast';
        if (defined('AIOSEO_VERSION')) return 'aioseo';
        return null;
    }

    private static function meta_keys(): array
    {
        switch (self::seo_plugin()) {
            case 'rank_math': return ['title' => 'rank_math_title', 'desc' => 'rank_math_description'];
            case 'yoast': return ['title' => '_yoast_wpseo_title', 'desc' => '_yoast_wpseo_metadesc'];
            case 'aioseo': return ['title' => '_aioseo_title', 'desc' => '_aioseo_description'];
            default: return ['title' => '_lsa_seo_title', 'desc' => '_lsa_meta_description'];
        }
    }

    private static function is_elementor(int $id): bool
    {
        return get_post_meta($id, '_elementor_edit_mode', true) === 'builder';
    }

    public static function status(): array
    {
        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $active = (array) get_option('active_plugins', []);
        return [
            'wpVersion' => get_bloginfo('version'),
            'theme' => wp_get_theme()->get('Name'),
            'plugins' => array_values(array_map(static fn($p) => dirname($p), $active)),
            'elementor' => defined('ELEMENTOR_VERSION'),
            'seoPlugin' => self::seo_plugin(),
        ];
    }

    private static function shape(WP_Post $p): array
    {
        $keys = self::meta_keys();
        $builder = self::is_elementor($p->ID) ? 'elementor' : (has_blocks($p->post_content) ? 'gutenberg' : 'classic');
        $text = $builder === 'elementor' ? self::elementor_text($p->ID) : wp_strip_all_tags($p->post_content);
        preg_match('/<h1[^>]*>(.*?)<\/h1>/is', $p->post_content, $m);
        return [
            'id' => $p->ID,
            'type' => $p->post_type,
            'url' => get_permalink($p),
            'title' => $p->post_title,
            'seoTitle' => get_post_meta($p->ID, $keys['title'], true) ?: null,
            'metaDescription' => get_post_meta($p->ID, $keys['desc'], true) ?: null,
            'h1' => isset($m[1]) ? wp_strip_all_tags($m[1]) : $p->post_title,
            'builder' => $builder,
            'text' => mb_substr(trim(preg_replace('/\s+/', ' ', $text)), 0, 20000),
            'status' => $p->post_status,
        ];
    }

    /** Safe Elementor extraction: text-editor & heading widgets only. */
    private static function elementor_text(int $id): string
    {
        $data = json_decode((string) get_post_meta($id, '_elementor_data', true), true);
        $out = [];
        $walk = static function ($nodes) use (&$walk, &$out) {
            foreach ((array) $nodes as $n) {
                if (($n['widgetType'] ?? '') === 'text-editor') $out[] = wp_strip_all_tags($n['settings']['editor'] ?? '');
                if (($n['widgetType'] ?? '') === 'heading') $out[] = wp_strip_all_tags($n['settings']['title'] ?? '');
                if (!empty($n['elements'])) $walk($n['elements']);
            }
        };
        $walk($data);
        return implode("\n", $out);
    }

    public static function list_content(WP_REST_Request $req): array
    {
        $q = new WP_Query(['post_type' => ['page', 'post'], 'post_status' => ['publish'], 'posts_per_page' => 50, 'paged' => max(1, (int) $req->get_param('page')), 'no_found_rows' => true]);
        return array_map([self::class, 'shape'], $q->posts);
    }

    public static function get_content(WP_REST_Request $req)
    {
        $p = get_post((int) $req['id']);
        return $p ? self::shape($p) : new WP_Error('lsa_not_found', 'Not found', ['status' => 404]);
    }

    public static function update_meta(WP_REST_Request $req)
    {
        $id = (int) $req->get_param('id');
        if (!get_post($id)) return new WP_Error('lsa_not_found', 'Not found', ['status' => 404]);
        $keys = self::meta_keys();
        $before = ['seoTitle' => get_post_meta($id, $keys['title'], true) ?: null, 'metaDescription' => get_post_meta($id, $keys['desc'], true) ?: null];
        if ($req->get_param('seoTitle') !== null) update_post_meta($id, $keys['title'], sanitize_text_field($req->get_param('seoTitle')));
        if ($req->get_param('metaDescription') !== null) update_post_meta($id, $keys['desc'], sanitize_text_field($req->get_param('metaDescription')));
        return ['ok' => true, 'before' => $before];
    }

    public static function image_alt(WP_REST_Request $req)
    {
        $id = attachment_url_to_postid(esc_url_raw((string) $req->get_param('imageUrl')));
        if (!$id) return new WP_Error('lsa_not_found', 'Image is not in the media library', ['status' => 404]);
        $before = get_post_meta($id, '_wp_attachment_image_alt', true) ?: null;
        update_post_meta($id, '_wp_attachment_image_alt', sanitize_text_field((string) $req->get_param('alt')));
        return ['ok' => true, 'before' => $before, 'attachmentId' => $id];
    }

    public static function schema(WP_REST_Request $req)
    {
        $id = (int) $req->get_param('id');
        if (!get_post($id)) return new WP_Error('lsa_not_found', 'Not found', ['status' => 404]);
        $before = get_post_meta($id, '_lsa_schema', true) ?: null;
        $json = wp_json_encode($req->get_param('jsonld'));
        if (!$json || strlen($json) > 50000) return new WP_Error('lsa_invalid', 'Invalid schema', ['status' => 400]);
        update_post_meta($id, '_lsa_schema', $json);
        return ['ok' => true, 'before' => $before ? json_decode($before, true) : null];
    }

    public static function print_schema(): void
    {
        if (!is_singular()) return;
        $json = get_post_meta(get_the_ID(), '_lsa_schema', true);
        if ($json) {
            echo "\n<script type=\"application/ld+json\">" . wp_kses_no_null($json) . "</script>\n";
        }
    }

    /**
     * Insert one internal link at the first un-linked occurrence of the anchor text.
     * Elementor pages: only text-editor widgets are touched; layout JSON structure is preserved.
     */
    public static function internal_link(WP_REST_Request $req)
    {
        $id = (int) $req->get_param('id');
        $anchor = (string) $req->get_param('anchor');
        $url = esc_url_raw((string) $req->get_param('url'));
        if (!get_post($id) || $anchor === '' || $url === '') return new WP_Error('lsa_invalid', 'Invalid request', ['status' => 400]);
        $link = sprintf('<a href="%s">%s</a>', esc_url($url), esc_html($anchor));
        $pattern = '/(?<![>\w])(' . preg_quote($anchor, '/') . ')(?![^<]*<\/a>)/i';
        if (self::is_elementor($id)) {
            $data = json_decode((string) get_post_meta($id, '_elementor_data', true), true);
            $applied = false;
            $walk = static function (&$nodes) use (&$walk, &$applied, $pattern, $link) {
                foreach ($nodes as &$n) {
                    if ($applied) return;
                    if (($n['widgetType'] ?? '') === 'text-editor' && isset($n['settings']['editor'])) {
                        $new = preg_replace($pattern, $link, $n['settings']['editor'], 1, $count);
                        if ($count) { $n['settings']['editor'] = $new; $applied = true; return; }
                    }
                    if (!empty($n['elements'])) $walk($n['elements']);
                }
            };
            $walk($data);
            if (!$applied) return ['ok' => true, 'applied' => false, 'reason' => 'Anchor text not found in an Elementor text widget'];
            update_post_meta($id, '_elementor_data', wp_slash(wp_json_encode($data)));
            if (class_exists('\Elementor\Plugin')) \Elementor\Plugin::$instance->files_manager->clear_cache();
            return ['ok' => true, 'applied' => true];
        }
        $post = get_post($id);
        $new = preg_replace($pattern, $link, $post->post_content, 1, $count);
        if (!$count) return ['ok' => true, 'applied' => false, 'reason' => 'Anchor text not found in content'];
        wp_update_post(['ID' => $id, 'post_content' => $new]);
        return ['ok' => true, 'applied' => true];
    }

    public static function replace_link(WP_REST_Request $req)
    {
        $id = (int) $req->get_param('id');
        $from = esc_url_raw((string) $req->get_param('from'));
        $to = esc_url_raw((string) $req->get_param('to'));
        $post = get_post($id);
        if (!$post || !$from || !$to) return new WP_Error('lsa_invalid', 'Invalid request', ['status' => 400]);
        $count = 0;
        if (self::is_elementor($id)) {
            $raw = (string) get_post_meta($id, '_elementor_data', true);
            $new = str_replace(addcslashes($from, '/'), addcslashes($to, '/'), $raw, $count);
            if ($count) update_post_meta($id, '_elementor_data', wp_slash($new));
        } else {
            $new = str_replace('href="' . $from . '"', 'href="' . $to . '"', $post->post_content, $count);
            if ($count) wp_update_post(['ID' => $id, 'post_content' => $new]);
        }
        return ['ok' => true, 'replaced' => $count];
    }

    public static function create_post(WP_REST_Request $req)
    {
        $status = in_array($req->get_param('status'), ['draft', 'future', 'publish'], true) ? $req->get_param('status') : 'draft';
        $postarr = [
            'post_title' => sanitize_text_field((string) $req->get_param('title')),
            'post_content' => wp_kses_post((string) $req->get_param('content')),
            'post_name' => sanitize_title((string) $req->get_param('slug')),
            'post_status' => $status,
            'post_type' => 'post',
        ];
        if ($status === 'future' && $req->get_param('date')) $postarr['post_date_gmt'] = gmdate('Y-m-d H:i:s', strtotime((string) $req->get_param('date')));
        $id = wp_insert_post($postarr, true);
        if (is_wp_error($id)) return $id;
        $keys = self::meta_keys();
        if ($req->get_param('seoTitle')) update_post_meta($id, $keys['title'], sanitize_text_field($req->get_param('seoTitle')));
        if ($req->get_param('metaDescription')) update_post_meta($id, $keys['desc'], sanitize_text_field($req->get_param('metaDescription')));
        if ($req->get_param('schema')) update_post_meta($id, '_lsa_schema', wp_json_encode($req->get_param('schema')));
        $img = esc_url_raw((string) $req->get_param('featuredImageUrl'));
        if ($img) {
            require_once ABSPATH . 'wp-admin/includes/media.php';
            require_once ABSPATH . 'wp-admin/includes/file.php';
            require_once ABSPATH . 'wp-admin/includes/image.php';
            $att = media_sideload_image($img, $id, sanitize_text_field((string) $req->get_param('featuredAlt')), 'id');
            if (!is_wp_error($att)) {
                set_post_thumbnail($id, $att);
                update_post_meta($att, '_wp_attachment_image_alt', sanitize_text_field((string) $req->get_param('featuredAlt')));
            }
        }
        return ['id' => $id, 'url' => get_permalink($id), 'status' => get_post_status($id)];
    }

    /** Snapshot of content + SEO metadata + Elementor data, used for backups before changes. */
    public static function snapshot(WP_REST_Request $req)
    {
        $id = (int) $req->get_param('id');
        $p = get_post($id);
        if (!$p) return new WP_Error('lsa_not_found', 'Not found', ['status' => 404]);
        $keys = self::meta_keys();
        return [
            'id' => $id,
            'post' => ['post_title' => $p->post_title, 'post_content' => $p->post_content, 'post_excerpt' => $p->post_excerpt, 'post_name' => $p->post_name, 'post_status' => $p->post_status],
            'meta' => [
                $keys['title'] => get_post_meta($id, $keys['title'], true),
                $keys['desc'] => get_post_meta($id, $keys['desc'], true),
                '_elementor_data' => get_post_meta($id, '_elementor_data', true),
                '_lsa_schema' => get_post_meta($id, '_lsa_schema', true),
            ],
        ];
    }

    public static function restore(WP_REST_Request $req)
    {
        $id = (int) $req->get_param('id');
        $post = (array) $req->get_param('post');
        $meta = (array) $req->get_param('meta');
        if (!get_post($id)) return new WP_Error('lsa_not_found', 'Not found', ['status' => 404]);
        $allowed = ['post_title', 'post_content', 'post_excerpt', 'post_name', 'post_status'];
        wp_update_post(array_merge(['ID' => $id], array_intersect_key($post, array_flip($allowed))));
        $keys = self::meta_keys();
        foreach ([$keys['title'], $keys['desc'], '_elementor_data', '_lsa_schema'] as $k) {
            if (array_key_exists($k, $meta)) {
                $meta[$k] === '' || $meta[$k] === null ? delete_post_meta($id, $k) : update_post_meta($id, $k, wp_slash($meta[$k]));
            }
        }
        if (class_exists('\Elementor\Plugin')) \Elementor\Plugin::$instance->files_manager->clear_cache();
        return ['ok' => true];
    }
}

LSA_Connector::init();
